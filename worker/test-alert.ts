import type { PushSubscription } from 'web-push';
import { MINUTE_MS } from '../src/alerts';
import { alertTag } from './alert-notification';
import { RETRY_MS, type PushOutcome } from './alert-queue';
import type { PushMessage } from './push-request';

/** The delay lets the user lock the phone or leave the app before the test arrives. */
export const TEST_DELAY_MS = 2 * MINUTE_MS;

/** Uses the tag and topic format of a real alert, so the test sends the same kind of request. */
export const testMessage = (at: number): PushMessage => ({
  title: 'Field Hours test alert',
  body: 'Shooting hours alerts can reach this device.',
  tag: alertTag(at),
});

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
