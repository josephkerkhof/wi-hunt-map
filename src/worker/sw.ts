// Vite prepends the release hash and built file list when emitting sw.js.
declare const RELEASE: string;
declare const PRECACHE: readonly string[];
declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'wi-field-hours-';
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const scope = new URL(self.registration.scope);
const urls = PRECACHE.map(path => new URL(path, scope).href);
const index = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
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
