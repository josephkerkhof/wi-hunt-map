import assert from 'node:assert/strict';
import type { PushSubscription } from 'web-push';
import { test } from 'vitest';
import { nextShootingEvent } from '../src/alerts';
import { alertNotification } from '../worker/alert-notification';
import { RETRY_MS } from '../worker/alert-queue';
import { TEST_DELAY_MS, retryTestAt, scheduleTest, testMessage } from '../worker/test-alert';

const subscription: PushSubscription = {
  endpoint: 'https://web.push.apple.com/example',
  keys: { auth: 'auth', p256dh: 'p256dh' },
};

const now = Date.parse('2026-11-21T22:00:00Z');

test('a test alert is due two minutes later, and another press keeps the first time', () => {
  const first = scheduleTest(undefined, subscription, now);
  assert.equal(first.at, now + TEST_DELAY_MS);
  assert.equal(TEST_DELAY_MS, 120_000);

  assert.equal(scheduleTest(first, subscription, now + 30_000).at, first.at);
  assert.equal(scheduleTest(first, subscription, first.at + 1).at, first.at + 1 + TEST_DELAY_MS);
});

test('a test alert uses the same tag and topic format as a real alert', () => {
  const location = { area: 'south', zone: 'B' } as const;
  const event = nextShootingEvent(location, new Date(now));
  assert.ok(event);
  const at = scheduleTest(undefined, subscription, now).at;

  assert.equal(testMessage(at).tag, alertNotification({ ...location, event }, at).tag);
});

test('a test alert that fails to send is retried for one minute, and a refusal is final', () => {
  const pending = scheduleTest(undefined, subscription, now);

  assert.equal(retryTestAt(pending, 'retry', pending.at), pending.at + RETRY_MS);
  assert.equal(retryTestAt(pending, 'retry', pending.at + 50_000), null);
  assert.equal(retryTestAt(pending, 'rejected', pending.at), null);
  assert.equal(retryTestAt(pending, 'delivered', pending.at), null);
});
