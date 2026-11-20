import { DurableObject } from 'cloudflare:workers';
import { generateRequestDetails, type PushSubscription } from 'web-push';
import {
  MINUTE_MS,
  nextShootingEvent,
  reminderTimes,
  subscriptionToken,
  type AlertSchedule,
} from '../src/alerts';
import { AREAS, isLocationChoice, type LocationChoice } from '../src/hours';
import { LocalNotificationTest } from './local-notification-test';

interface Env {
  ALERTS: DurableObjectNamespace<EventAlerts>;
  LOCAL_ALERT_TEST_TOKEN?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

type AlertRequest = LocationChoice & { eventAt: number; subscription: PushSubscription };

interface ArmedAlerts {
  id: string;
  schedule: AlertSchedule;
  subscription: PushSubscription;
  pending: number[];
}

const key = 'armed';
const api = '/api/alerts';
const maxBodyBytes = 8192;

const eventTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

function isPushSubscription(value: unknown): value is PushSubscription {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('endpoint' in value) ||
    typeof value.endpoint !== 'string' ||
    value.endpoint.length > 4096 ||
    !('keys' in value) ||
    typeof value.keys !== 'object' ||
    value.keys === null
  )
    return false;

  const endpoint = URL.parse(value.endpoint);
  const keys = value.keys;

  return (
    endpoint !== null &&
    endpoint.protocol === 'https:' &&
    !endpoint.port &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.hash &&
    (endpoint.hostname.endsWith('.push.apple.com') ||
      endpoint.hostname === 'fcm.googleapis.com' ||
      endpoint.hostname === 'updates.push.services.mozilla.com' ||
      endpoint.hostname.endsWith('.notify.windows.com')) &&
    'p256dh' in keys &&
    typeof keys.p256dh === 'string' &&
    /^B[A-Za-z0-9_-]{86}$/.test(keys.p256dh) &&
    'auth' in keys &&
    typeof keys.auth === 'string' &&
    /^[A-Za-z0-9_-]{22}$/.test(keys.auth)
  );
}

function isAlertRequest(value: unknown): value is AlertRequest {
  return (
    isLocationChoice(value) &&
    'eventAt' in value &&
    typeof value.eventAt === 'number' &&
    Number.isSafeInteger(value.eventAt) &&
    'subscription' in value &&
    isPushSubscription(value.subscription)
  );
}

async function readAlertRequest(request: Request): Promise<AlertRequest | null> {
  const reader = request.body?.getReader();

  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let body = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      length += value.byteLength;

      if (length > maxBodyBytes) {
        await reader.cancel();

        return null;
      }

      body += decoder.decode(value, { stream: true });
    }

    const data: unknown = JSON.parse(body + decoder.decode());

    return isAlertRequest(data) ? data : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function json<T>(body: T, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const localTest = Boolean(env.LOCAL_ALERT_TEST_TOKEN);

    if (localTest && url.pathname === api + '/test') {
      return env.ALERTS.getByName('local-notification-test').fetch(request);
    }

    if (url.pathname !== api && url.pathname !== api + '/key') return json({}, 404);

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return json({ message: 'Alerts are unavailable right now.' }, 503);
    }

    if (url.pathname === api + '/key' && request.method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY, localTest });
    }

    if (url.pathname !== api || !['GET', 'PUT', 'DELETE'].includes(request.method)) {
      return json({}, 405);
    }

    // The token is derived from the browser's private subscription credentials.
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];

    if (!token) return json({}, 401);
    const alerts = env.ALERTS.getByName(token);

    if (request.method === 'GET') return json({ schedule: await alerts.active() });

    if (request.method === 'DELETE') {
      await alerts.disarm();

      return json({ schedule: null });
    }

    const data = await readAlertRequest(request);

    if (!data) return json({ message: 'This browser’s push subscription could not be used.' }, 400);
    const { endpoint, keys } = data.subscription;

    if (token !== (await subscriptionToken(endpoint, keys.auth))) return json({}, 403);

    const result = await alerts.arm({
      area: data.area,
      zone: data.zone,
      eventAt: data.eventAt,
      subscription: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
    });

    return json(result, 'message' in result ? 409 : 200);
  },
} satisfies ExportedHandler<Env>;

export class EventAlerts extends DurableObject<Env> {
  private localTest?: LocalNotificationTest;

  fetch(request: Request) {
    const token = this.env.LOCAL_ALERT_TEST_TOKEN;

    if (!token) return json({}, 404);
    this.localTest ??= new LocalNotificationTest();

    return this.localTest.fetch(request, token);
  }

  async active(): Promise<AlertSchedule | null> {
    const armed = await this.ctx.storage.get<ArmedAlerts>(key);

    return armed && armed.schedule.event.at > Date.now() ? armed.schedule : null;
  }

  arm({ area, zone, eventAt, subscription }: AlertRequest) {
    return this.ctx.storage.transaction(async storage => {
      const now = new Date();
      const current = await storage.get<ArmedAlerts>(key);

      if (current && current.schedule.event.at > now.getTime()) {
        const { schedule } = current;

        return schedule.area === area && schedule.zone === zone && schedule.event.at === eventAt
          ? { schedule }
          : { message: 'Turn off the current alerts before enabling a new set.' };
      }

      const event = nextShootingEvent({ area, zone }, now);

      if (!event || event.at !== eventAt) {
        return { message: 'The next event has changed. Review it before enabling alerts.' };
      }

      const pending = reminderTimes(event, now.getTime());
      const first = pending[0];

      if (first === undefined) return { message: 'The last reminder for this event has passed.' };
      const schedule = { area, zone, event };
      const armed: ArmedAlerts = { id: crypto.randomUUID(), schedule, subscription, pending };
      await storage.put(key, armed);
      await storage.setAlarm(first);

      return { schedule };
    });
  }

  async disarm() {
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const delivery = await this.ctx.storage.transaction(async storage => {
      const armed = await storage.get<ArmedAlerts>(key);

      // Local alarm tests from older development builds may still be queued.
      if (!armed?.schedule) return null;

      const now = Date.now();
      const { event } = armed.schedule;

      if (now >= event.at) {
        await storage.delete(key);
        await storage.deleteAlarm();

        return null;
      }

      const due = armed.pending.filter(at => at <= now).at(-1);
      armed.pending = armed.pending.filter(at => at > now);
      await storage.put(key, armed);
      await storage.setAlarm(armed.pending[0] ?? event.at);

      return due === undefined ? null : { armed, due };
    });

    if (!delivery) return;
    const { armed, due } = delivery;
    const { area, zone, event } = armed.schedule;
    const expires = Math.min(due + MINUTE_MS, event.at);
    const ttl = Math.floor((expires - Date.now()) / 1000);

    if (ttl <= 0) return;
    const action = event.kind === 'opening' ? 'open' : 'close';
    const title = `Shooting hours ${action} in ${(event.at - due) / MINUTE_MS} min`;
    const body = `${eventTime.format(event.at)} CT · ${AREAS[area]} Zone ${zone}`;
    const tag = `field-hours-${due}`;

    try {
      const details = generateRequestDetails(
        armed.subscription,
        JSON.stringify({ title, body, tag }),
        {
          TTL: ttl,
          contentEncoding: 'aes128gcm',
          topic: tag,
          urgency: 'high',
          vapidDetails: {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY,
          },
        },
      );

      const current = await this.ctx.storage.get<ArmedAlerts>(key);
      const remaining = Math.floor((expires - Date.now()) / 1000);

      if (current?.id !== armed.id || remaining <= 0) return;
      const headers = new Headers(details.headers);
      headers.set('TTL', String(remaining));

      const response = await fetch(details.endpoint, {
        method: details.method,
        headers,
        body: details.body ? new Uint8Array(details.body) : null,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });

      await response.body?.cancel();

      if (response.status === 404 || response.status === 410) {
        await this.ctx.storage.transaction(async storage => {
          const current = await storage.get<ArmedAlerts>(key);

          if (current?.id !== armed.id) return;
          await storage.delete(key);
          await storage.deleteAlarm();
        });
      } else if (!response.ok) {
        console.warn('Push delivery rejected.', response.status);
      }
    } catch {
      // The next reminder is already scheduled. Avoid retrying an uncertain delivery.
      console.warn('Push delivery failed.');
    }
  }
}
