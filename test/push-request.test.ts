import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { generateVAPIDKeys } from 'web-push';
import { afterEach, test, vi } from 'vitest';
import { alertTag } from '../worker/alert-notification';
import { deliverPush, pushRequest, pushTopic, sendPush } from '../worker/push-request';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const samplePush = () =>
  pushRequest({
    method: 'POST',
    endpoint: 'https://web.push.apple.com/example',
    headers: { TTL: '60', Urgency: 'high' },
    body: Buffer.from('payload'),
  });

const reply =
  (status: number, body: string | null = null) =>
  () =>
    Promise.resolve(new Response(body, { status }));

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

/** Apple refuses a Topic that does not decode as base64url, such as one with 25 characters. */
const decodes = (topic: string) => Buffer.from(topic, 'base64url').toString('base64url') === topic;

test('a push sends a 32-character Topic that decodes as base64url', async () => {
  const device = createECDH('prime256v1');
  device.generateKeys();
  const vapid = generateVAPIDKeys();
  const topics: (string | null)[] = [];

  vi.stubGlobal('fetch', (request: Request) => {
    topics.push(request.headers.get('Topic'));

    return reply(201)();
  });

  const outcome = await deliverPush(
    {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'https://deer.kerkhof.dev/',
    },
    {
      endpoint: 'https://web.push.apple.com/example',
      keys: {
        p256dh: device.getPublicKey('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
    { title: 'Shooting hours close in 10 min', body: 'Test', tag: alertTag(1795350840000) },
    60,
  );

  assert.equal(outcome, 'delivered');
  assert.equal(topics.length, 1);
  const [topic] = topics;
  assert.match(topic ?? '', /^[A-Za-z0-9_-]{32}$/);
  assert.ok(topic && decodes(topic));
});

test('each alert keeps one Topic, so a retry replaces the first copy', () => {
  const topic = pushTopic(alertTag(1795350840000));

  assert.equal(pushTopic(alertTag(1795350840000)), topic);
  assert.notEqual(pushTopic(alertTag(1795350900000)), topic);
});

test('a refused push logs the reason from the push service', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  assert.equal(await sendPush(samplePush, reply(400, '{"reason":"BadJwtToken"}')), 'rejected');
  assert.equal(await sendPush(samplePush, reply(503, 'Service Unavailable')), 'retry');

  assert.deepEqual(warn.mock.calls, [
    ['Push service status.', 400, 'BadJwtToken'],
    ['Push service status.', 503, 'Service Unavailable'],
  ]);
});
