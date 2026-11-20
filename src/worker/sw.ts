// Vite prepends the release hash and built file list when emitting sw.js.
declare const RELEASE: string;
declare const PRECACHE: readonly string[];
declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'wi-field-hours-';
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const scope = new URL(self.registration.scope);
const urls = PRECACHE.map(path => new URL(path, scope).href);
const index = new URL('index.html', scope).href;

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

self.addEventListener('push', event => {
  try {
    const message: unknown = event.data?.json();

    if (!isAlertMessage(message)) return;
    event.waitUntil(
      self.registration.showNotification(message.title, {
        body: message.body,
        tag: message.tag,
        icon: new URL('assets/icon-192.png', scope).href,
      }),
    );
  } catch {
    // Ignore malformed messages.
  }
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
