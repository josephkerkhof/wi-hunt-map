// Vite prepends the release hash and built file list when emitting sw.js.
declare const RELEASE: string;
declare const PRECACHE: readonly string[];
declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'wi-field-hours-';
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const scope = new URL(self.registration.scope);
const urls = PRECACHE.map(path => new URL(path, scope).href);
const index = new URL('index.html', scope).href;
const alertsApi = new URL('api/alerts', scope).href;

// Not yet in TypeScript's WebWorker library.
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription: PushSubscription | null;
  readonly newSubscription: PushSubscription | null;
}

type StoredSchedule = { area: string; zone: string; event: { at: number } };

function isAlertMessage(value: unknown): value is { title: string; body: string; tag: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'tag' in value &&
    typeof value.tag === 'string'
  );
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      if (urls.length > 0) {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== scope.origin) return;
  url.search = '';
  url.hash = '';

  if (request.mode === 'navigate' && url.href === index) url.href = scope.href;

  if (!urls.includes(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      return (await cache.match(url.href)) || fetch(request);
    })(),
  );
});

function readPush(event: PushEvent) {
  try {
    const message: unknown = event.data?.json();

    if (isAlertMessage(message)) return message;
  } catch {
    // Show the fallback below.
  }

  return null;
}

self.addEventListener('push', event => {
  // Every push must show a notification, or the browser can revoke the subscription.
  const message = readPush(event) ?? {
    title: 'Field Hours',
    body: 'Open Field Hours to check today’s shooting hours.',
    tag: 'field-hours-update',
  };

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: new URL('assets/icon-192.png', scope).href,
    }),
  );
});

// Keep in sync with subscriptionToken in src/alerts.ts. The service worker is built without imports.
async function subscriptionToken(subscription: PushSubscription) {
  const auth = subscription.toJSON().keys?.auth;

  if (!auth) return null;
  const input = new TextEncoder().encode(`${subscription.endpoint}\n${auth}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));

  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function alertRequest(token: string, method: string, body?: string) {
  return fetch(alertsApi, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
}

function isStoredSchedule(value: unknown): value is { schedule: StoredSchedule } {
  if (typeof value !== 'object' || value === null || !('schedule' in value)) return false;
  const schedule: unknown = value.schedule;

  return (
    typeof schedule === 'object' &&
    schedule !== null &&
    'area' in schedule &&
    typeof schedule.area === 'string' &&
    'zone' in schedule &&
    typeof schedule.zone === 'string' &&
    'event' in schedule &&
    typeof schedule.event === 'object' &&
    schedule.event !== null &&
    'at' in schedule.event &&
    typeof schedule.event.at === 'number'
  );
}

/** Moves armed alerts from a replaced push subscription to its replacement. */
async function moveAlerts(previous: PushSubscription | null, next: PushSubscription | null) {
  const previousToken = previous && (await subscriptionToken(previous));

  if (!previous || !previousToken) return;
  const response = await alertRequest(previousToken, 'GET');
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok || !isStoredSchedule(data)) return;
  const { area, zone, event } = data.schedule;

  const replacement =
    next ??
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: previous.options.applicationServerKey,
    }));

  const token = await subscriptionToken(replacement);

  if (!token) return;
  const subscription = replacement.toJSON();
  const body = JSON.stringify({ area, zone, eventAt: event.at, subscription });
  const armed = await alertRequest(token, 'PUT', body);

  if (armed.ok) await alertRequest(previousToken, 'DELETE');
}

self.addEventListener('pushsubscriptionchange', event => {
  // SAFETY: browsers dispatch pushsubscriptionchange only as a PushSubscriptionChangeEvent.
  const change = event as PushSubscriptionChangeEvent;
  change.waitUntil(
    moveAlerts(change.oldSubscription, change.newSubscription).catch(() => {
      // The app explains that alerts stopped the next time it checks.
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      const app = windows.find(client => {
        const url = new URL(client.url);
        url.search = '';
        url.hash = '';

        return url.href === scope.href || url.href === index;
      });

      if (app) await app.focus();
      else await self.clients.openWindow(scope.href);
    })(),
  );
});
