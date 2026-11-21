import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { pushRequest, sendPush } from '../worker/push-request';

afterEach(() => {
  vi.restoreAllMocks();
});

const samplePush = () =>
  pushRequest({
    method: 'POST',
    endpoint: 'https://web.push.apple.com/example',
    headers: { TTL: '60', Urgency: 'high' },
    body: Buffer.from('payload'),
  });

const reply = (status: number) => () => Promise.resolve(new Response(null, { status }));

test('builds a push request that Workers fetch accepts', async () => {
  const request = samplePush();

  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://web.push.apple.com/example');
  assert.equal(request.headers.get('TTL'), '60');
  assert.equal(await request.text(), 'payload');
  // Workers fetch throws a TypeError for 'error'. A redirect response counts as rejected.
  assert.equal(request.redirect, 'manual');
});

test('a push request that cannot be built fails without a retry and logs an error', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let sends = 0;

  const outcome = await sendPush(
    () => {
      throw new TypeError('Invalid redirect value');
    },
    () => {
      sends++;

      return reply(201)();
    },
  );

  assert.equal(outcome, 'failed');
  assert.equal(sends, 0);
  assert.deepEqual(error.mock.calls, [
    ['Push request could not be built.', 'TypeError: Invalid redirect value'],
  ]);
});

test('a push that fails to send is retried and logs the reason', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const outcome = await sendPush(samplePush, () =>
    Promise.reject(new Error('Network connection lost.')),
  );

  assert.equal(outcome, 'retry');
  assert.deepEqual(warn.mock.calls, [['Push request failed.', 'Error: Network connection lost.']]);
});

test('a sent push returns the push service outcome', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  assert.equal(await sendPush(samplePush, reply(201)), 'delivered');
  assert.equal(await sendPush(samplePush, reply(410)), 'gone');
  assert.equal(await sendPush(samplePush, reply(302)), 'rejected');
});
