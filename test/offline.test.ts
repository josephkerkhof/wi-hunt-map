import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { normalizePath } from 'vite';
import { test } from 'vitest';

type WorkerEvent = {
  request?: Pick<Request, 'method' | 'mode' | 'url'>;
  waitUntil(work: Promise<void>): void;
  respondWith(work: Promise<Buffer | undefined>): void;
};

type EventName = 'install' | 'activate' | 'fetch';

const run = promisify(execFile);
const vite = fileURLToPath(new URL('./bin/vite.js', import.meta.resolve('vite/package.json')));

test('the production worker serves the complete install from cache with the network disabled', async ({
  onTestFinished,
}) => {
  const dist = await mkdtemp(join(tmpdir(), 'field-hours-'));
  onTestFinished(() => rm(dist, { recursive: true, force: true }));
  await run(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const scope = 'https://field-hours.example/field-hours/';
  const handlers = new Map<EventName, (event: WorkerEvent) => void>();
  const cache = new Map<string, Buffer>();
  let network = true;
  let claimed = false;

  const worker = {
    registration: { scope },
    addEventListener: (name: EventName, handler: (event: WorkerEvent) => void) => {
      handlers.set(name, handler);
    },
    clients: {
      claim: () => {
        claimed = true;
      },
    },
  };

  const caches = {
    async open(name: string) {
      assert.match(name, /^wi-field-hours-[a-f0-9]{16}$/);

      return {
        async addAll(requests: Request[]) {
          assert.equal(network, true);
          await Promise.all(
            requests.map(async ({ url }) => {
              assert.ok(url.startsWith(scope));
              const path = url === scope ? 'index.html' : url.slice(scope.length);
              cache.set(url, await readFile(join(dist, path)));
            }),
          );
        },
        match: (url: string) => cache.get(url),
      };
    },
    keys: async () => [],
  };

  function fetch() {
    assert.fail('The network is disabled');
  }

  runInNewContext(await readFile(join(dist, 'sw.js'), 'utf8'), {
    self: worker,
    caches,
    Request,
    URL,
    fetch,
  });

  async function dispatch(
    name: EventName,
    data: Omit<WorkerEvent, 'waitUntil' | 'respondWith'> = {},
  ) {
    let response: Promise<void | Buffer | undefined> | undefined;
    const handler = handlers.get(name);
    assert.ok(handler);
    handler({
      ...data,
      waitUntil: work => {
        response = work;
      },
      respondWith: work => {
        response = work;
      },
    });

    return response;
  }

  const request = (url: string, mode: RequestMode = 'cors') =>
    dispatch('fetch', { request: { method: 'GET', mode, url } });

  await dispatch('install');
  await dispatch('activate');
  assert.equal(claimed, true);
  network = false;

  const entries = await readdir(dist, { recursive: true, withFileTypes: true });

  const urls = entries.flatMap(entry => {
    if (!entry.isFile() || ['sw.js', '_headers'].includes(entry.name)) return [];
    const path = normalizePath(relative(dist, join(entry.parentPath, entry.name)));

    return [new URL(path === 'index.html' ? './' : path, scope).href];
  });

  assert.deepEqual(new Set(cache.keys()), new Set(urls));

  const index = cache.get(scope);
  assert.ok(index);
  assert.equal(await request(scope + '?opened=offline', 'navigate'), index);
  assert.equal(await request(scope + '#main', 'navigate'), index);
  assert.equal(await request(scope + 'index.html', 'navigate'), index);

  for (const [, path] of index.toString('utf8').matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    assert.ok(path);
    const url = new URL(path, scope);
    url.hash = '';

    if (url.origin === new URL(scope).origin)
      assert.ok(cache.has(url.href), `Expected ${path} in the offline cache`);
  }

  for (const url of cache.keys()) {
    assert.equal(await request(url), cache.get(url));
  }

  assert.equal(await request('https://dnr.wisconsin.gov/'), undefined);
});
