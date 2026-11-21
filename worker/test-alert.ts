import type { PushSubscription } from 'web-push';
import { MINUTE_MS } from '../src/alerts';
import { RETRY_MS, type PushOutcome } from './alert-queue';
import type { PushMessage } from './push-request';

/** The delay lets the user lock the phone or leave the app before the test arrives. */
export const TEST_DELAY_MS = 2 * MINUTE_MS;

export const testMessage: PushMessage = {
  title: 'Field Hours test alert',
  body: 'Shooting hours alerts can reach this device.',
  tag: 'field-hours-test',
};

export interface PendingTest {
  at: number;
  subscription: PushSubscription;
}

/** A test that is still waiting keeps its time, so repeated presses send one alert. */
export function scheduleTest(
  pending: PendingTest | undefined,
  subscription: PushSubscription,
  now: number,
): PendingTest {
  return pending && pending.at > now ? pending : { at: now + TEST_DELAY_MS, subscription };
}

/** Like an alert, a test is useful for one minute. Returns null when the test is finished. */
export function retryTestAt(pending: PendingTest, outcome: PushOutcome, now: number) {
  const next = now + RETRY_MS;

  return outcome === 'retry' && next < pending.at + MINUTE_MS ? next : null;
}
