import { DurableObject } from 'cloudflare:workers';
import type { PushSubscription } from 'web-push';
import { MINUTE_MS, nextShootingEvent, subscriptionToken, type AlertSchedule } from '../src/alerts';
import { isLocationChoice, type LocationChoice } from '../src/hours';
import { alertNotification } from './alert-notification';
import {
  armAlerts,
  completeDelivery,
  deliveryExpires,
  planAlarm,
  readArmed,
  sameDelivery,
  type ArmedAlerts,
  type Delivery,
  type PushOutcome,
  type StoredAlerts,
} from './alert-queue';
import { LocalNotificationTest } from './local-notification-test';
import { deliverPush, type VapidEnv } from './push-request';

interface Env extends VapidEnv {
  ALERTS: DurableObjectNamespace<EventAlerts>;
  ALERT_REQUESTS: RateLimit;
  ALERT_CHANGES: RateLimit;
  LOCAL_ALERT_TEST_TOKEN?: string;
}

type AlertRequest = LocationChoice & { eventAt: number; subscription: PushSubscription };

const key = 'armed';
const api = '/api/alerts';
const maxBodyBytes = 8192;

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
    const client = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const limiter = request.method === 'PUT' ? env.ALERT_CHANGES : env.ALERT_REQUESTS;

    if (!(await limiter.limit({ key: client })).success) {
      return json({ message: 'Too many alert requests. Wait a minute and try again.' }, 429);
    }

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
    const armed = readArmed(await this.ctx.storage.get<StoredAlerts>(key));

    return armed && armed.schedule.event.at > Date.now() ? armed.schedule : null;
  }

  arm({ area, zone, eventAt, subscription }: AlertRequest) {
    return this.ctx.storage.transaction(async storage => {
      const now = new Date();
      const current = readArmed(await storage.get<StoredAlerts>(key));

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

      const schedule = { area, zone, event };
      const armed = armAlerts(current, schedule, subscription, now.getTime());
      await storage.put(key, armed);
      await storage.setAlarm(armed.queue[0]?.due ?? event.at);

      return { schedule };
    });
  }

  async disarm() {
    await this.ctx.storage.deleteAll();
  }

  private async store(record: ArmedAlerts | null, alarm: number | null) {
    const { storage } = this.ctx;

    if (record && alarm !== null) {
      await storage.put(key, record);
      await storage.setAlarm(alarm);
    } else {
      await storage.delete(key);
      await storage.deleteAlarm();
    }
  }

  async alarm() {
    const plan = await this.ctx.storage.transaction(async storage => {
      // Local alarm tests from older development builds may still be queued.
      const armed = readArmed(await storage.get<StoredAlerts>(key));

      if (!armed) return null;
      const plan = planAlarm(armed, Date.now());
      await this.store(plan.record, plan.alarm);

      return { ...plan, subscription: armed.subscription };
    });

    if (!plan) return;

    for (const delivery of plan.expired) {
      console.warn('Alert expired before delivery.', describe(delivery));
    }

    if (!plan.send) return;
    const { send } = plan;
    const outcome = await this.deliver(plan.subscription, send);

    if (!outcome) return;

    if (outcome === 'delivered') console.log('Alert delivered.', describe(send));
    else if (outcome === 'retry') console.warn('Alert delivery will be retried.', describe(send));
    else if (outcome === 'gone') console.warn('Push subscription expired.', describe(send));
    else if (outcome === 'failed') console.error('Alert could not be sent.', describe(send));
    else console.error('Push service rejected the alert.', describe(send));

    await this.ctx.storage.transaction(async storage => {
      const armed = readArmed(await storage.get<StoredAlerts>(key));
      const next = armed && completeDelivery(armed, send, outcome);

      if (next) await this.store(next.record, next.alarm);
    });
  }

  /** Sends one delivery. Returns null when it was cancelled or expired before sending. */
  private async deliver(
    subscription: PushSubscription,
    delivery: Delivery,
  ): Promise<PushOutcome | null> {
    const current = readArmed(await this.ctx.storage.get<StoredAlerts>(key));
    const ttl = Math.floor((deliveryExpires(delivery) - Date.now()) / 1000);

    // Turning alerts off removes queued deliveries, including one being retried.
    if (!current?.queue.some(queued => sameDelivery(queued, delivery)) || ttl <= 0) return null;

    const notification = alertNotification(delivery.schedule, delivery.due);

    return deliverPush(this.env, subscription, notification, ttl);
  }
}

function describe({ due, schedule }: Delivery) {
  const { area, zone, event } = schedule;

  return {
    event: event.kind,
    eventAt: new Date(event.at).toISOString(),
    minutesBefore: Math.round((event.at - due) / MINUTE_MS),
    area,
    zone,
  };
}
