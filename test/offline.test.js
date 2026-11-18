import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('the production worker serves the complete install from cache with the network disabled', async () => {
  const dist = new URL('../dist/', import.meta.url);
  const scope = 'https://field-hours.example/';
  const handlers = new Map();
  const cache = new Map();
  let network = true;
  let claimed = false;
  const worker = {
    registration: { scope },
    addEventListener: (name, handler) => handlers.set(name, handler),
    clients: { claim: () => { claimed = true; } },
  };
  const caches = {
    async open() {
      return {
        async addAll(requests) {
          assert.equal(network, true);
          const entries = await Promise.all(requests.map(async ({ url }) => [
            url, await readFile(new URL(url === scope ? 'index.html' : url.slice(scope.length), dist)),
          ]));
          entries.forEach(([url, bytes]) => cache.set(url, bytes));
        },
        match: url => cache.get(url),
      };
    },
    keys: async () => [],
  };
  function fetch() {
    assert.fail('The network is disabled');
  }
  runInNewContext(await readFile(new URL('sw.js', dist), 'utf8'), { self: worker, caches, Request, URL, fetch });

  async function dispatch(name, data = {}) {
    let response;
    handlers.get(name)({ ...data, waitUntil: work => { response = work; }, respondWith: work => { response = work; } });
    return response;
  }

  await dispatch('install');
  await dispatch('activate');
  assert.equal(claimed, true);
  network = false;
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const paths = entries.filter(entry => entry.isFile() && !['sw.js', '_headers'].includes(entry.name));
  assert.equal(cache.size, paths.length);
  assert.equal(await dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: scope + '?opened=offline' } }), cache.get(scope));
  assert.equal(await dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: scope + 'index.html' } }), cache.get(scope));
  for (const url of cache.keys()) {
    assert.equal(await dispatch('fetch', { request: { method: 'GET', mode: 'cors', url } }), cache.get(url));
  }
  assert.equal(await dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: 'https://dnr.wisconsin.gov/' } }), undefined);

  let ready;
  const status = { data: 'offline-status', ports: [{ postMessage: message => { ready = message.ready; } }] };
  await dispatch('message', status);
  assert.equal(ready, true);
  cache.delete(scope + 'assets/hours-data.js');
  await dispatch('message', status);
  assert.equal(ready, false);
});
