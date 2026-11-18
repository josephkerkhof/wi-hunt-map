// The build fills in the release hash and static file list.
const CACHE_PREFIX = 'wi-field-hours-';
const CACHE_NAME = CACHE_PREFIX + '__RELEASE__';
const PATHS = __PRECACHE__;
const urls = PATHS.map(path => new URL(path, self.registration.scope).href);
const scope = new URL(self.registration.scope);
const index = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  url.search = '';
  if (request.mode === 'navigate' && url.href === index) url.href = scope.href;
  if (!urls.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(url.href) || fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data !== 'offline-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.all(urls.map(url => cache.match(url)));
    event.ports[0].postMessage({ ready: results.every(Boolean) });
  })());
});
