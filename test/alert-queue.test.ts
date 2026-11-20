import assert from 'node:assert/strict';
import type { PushSubscription } from 'web-push';
import { test } from 'vitest';
import { nextShootingEvent, type AlertSchedule } from '../src/alerts';
import type { LocationChoice } from '../src/hours';
import { alertNotification } from '../worker/alert-notification';
import {
  RETRY_MS,
  armAlerts,
  completeDelivery,
  planAlarm,
  pushOutcome,
  readArmed,
  type ArmedAlerts,
  type PushOutcome,
} from '../worker/alert-queue';

const location: LocationChoice = { area: 'south', zone: 'B' };
const opens = Date.parse('2026-11-20T12:26:00Z');

const subscription: PushSubscription = {
  endpoint: 'https://web.push.apple.com/example',
  keys: { auth: 'auth', p256dh: 'p256dh' },
};

function scheduleAt(now: number): AlertSchedule {
  const event = nextShootingEvent(location, new Date(now));
  assert.ok(event);

  return { ...location, event };
}

/**
 * Runs the Durable Object's alarm loop. `outcomeAt` decides each push result, and
 * `delayMs` makes every alarm fire late.
 */
function run(
  record: ArmedAlerts,
  alarm: number,
  outcomeAt: (time: number) => PushOutcome = () => 'delivered',
  delayMs = 0,
) {
  const sent: { at: number; title: string }[] = [];
  let state: ArmedAlerts | null = record;
  let next: number | null = alarm;

  for (let guard = 0; state && next !== null && guard < 100; guard++) {
    const now = next + delayMs;
    const plan = planAlarm(state, now);
    state = plan.record;
    next = plan.alarm;

    if (!plan.send || !state) continue;
    const outcome = outcomeAt(now);

    if (outcome === 'delivered') {
      sent.push({ at: now, title: alertNotification(plan.send.schedule, plan.send.due).title });
    }

    const done = completeDelivery(state, plan.send, outcome);

    if (done) {
      state = done.record;
      next = done.alarm;
    }
  }

  return { sent, state };
}

const minutesBefore = (at: number) => (opens - at) / 60_000;

test('the night before, arms four reminders and the opening alert, then clears', () => {
  const now = Date.parse('2026-11-20T03:00:00Z');
  const schedule = scheduleAt(now);
  assert.equal(schedule.event.at, opens);
  const armed = armAlerts(null, schedule, subscription, now);

  assert.deepEqual(
    armed.queue.map(delivery => minutesBefore(delivery.due)),
    [10, 5, 3, 1, 0],
  );

  const { sent, state } = run(armed, armed.queue[0]!.due);

  assert.deepEqual(
    sent.map(({ at, title }) => [minutesBefore(at), title]),
    [
      [10, 'Shooting hours open in 10 min'],
      [5, 'Shooting hours open in 5 min'],
      [3, 'Shooting hours open in 3 min'],
      [1, 'Shooting hours open in 1 min'],
      [0, 'Shooting hours have started'],
    ],
  );
  assert.equal(state, null);
});

test('a record from the first release keeps its reminders and gains the final alert', () => {
  const schedule = scheduleAt(Date.parse('2026-11-20T03:00:00Z'));
  const reminders = [10, 5, 3, 1].map(minutes => opens - minutes * 60_000);
  const legacy = { id: 'x', schedule, subscription, pending: reminders };
  const armed = readArmed(legacy);
  assert.ok(armed);

  assert.deepEqual(
    run(armed, reminders[0]!).sent.map(({ at }) => minutesBefore(at)),
    [10, 5, 3, 1, 0],
  );
  assert.deepEqual(readArmed({ ...legacy, pending: null })?.queue, []);
  assert.equal(readArmed(undefined), null);
});

test('alarms up to a minute late still deliver every alert', () => {
  const now = Date.parse('2026-11-20T03:00:00Z');
  const armed = armAlerts(null, scheduleAt(now), subscription, now);
  const { sent } = run(armed, armed.queue[0]!.due, () => 'delivered', 45_000);

  assert.equal(sent.length, 5);
});

test('an alarm over a minute late skips the stale reminder and keeps the rest', () => {
  const now = Date.parse('2026-11-20T03:00:00Z');
  const armed = armAlerts(null, scheduleAt(now), subscription, now);
  const plan = planAlarm(armed, opens - 8 * 60_000);

  assert.deepEqual(
    plan.expired.map(delivery => minutesBefore(delivery.due)),
    [10],
  );
  assert.equal(plan.send, null);
  assert.equal(plan.alarm, opens - 5 * 60_000);
});

test('a failed push is retried until it is delivered or expires', () => {
  const now = Date.parse('2026-11-20T03:00:00Z');
  const armed = armAlerts(null, scheduleAt(now), subscription, now);
  const tenMinutes = opens - 10 * 60_000;
  let attempts = 0;

  const { sent } = run(armed, tenMinutes, time => {
    if (time < tenMinutes + 60_000) attempts++;

    return time < tenMinutes + 2 * RETRY_MS ? 'retry' : 'delivered';
  });

  assert.equal(attempts, 3);
  assert.deepEqual(
    sent.map(({ at }) => at - opens),
    [-10 * 60_000 + 2 * RETRY_MS, -5 * 60_000, -3 * 60_000, -60_000, 0],
  );

  const failing = run(armed, tenMinutes, () => 'retry');
  assert.deepEqual(failing.sent, []);
  assert.equal(failing.state, null);
});

test('a rejected push moves on to the next alert and an expired subscription clears', () => {
  const now = Date.parse('2026-11-20T03:00:00Z');
  const armed = armAlerts(null, scheduleAt(now), subscription, now);
  const tenMinutes = opens - 10 * 60_000;

  const rejected = run(armed, tenMinutes, time => (time === tenMinutes ? 'rejected' : 'delivered'));
  assert.deepEqual(
    rejected.sent.map(({ at }) => minutesBefore(at)),
    [5, 3, 1, 0],
  );

  const gone = run(armed, tenMinutes, () => 'gone');
  assert.deepEqual(gone.sent, []);
  assert.equal(gone.state, null);
});

test('enabling the closing during the opening minute keeps the opening alert', () => {
  const before = Date.parse('2026-11-20T03:00:00Z');
  const opening = armAlerts(null, scheduleAt(before), subscription, before);
  const now = opens + 5000;
  const closing = scheduleAt(now);
  assert.equal(closing.event.kind, 'closing');

  const both = armAlerts(opening, closing, subscription, now);
  const first = planAlarm(both, now);

  assert.equal(first.send?.schedule.event.kind, 'opening');
  assert.equal(first.send?.due, opens);

  const { sent } = run(both, now);
  assert.equal(sent[0]?.title, 'Shooting hours have started');
  assert.equal(sent.at(-1)?.title, 'Shooting hours have ended');
  assert.equal(sent.length, 6);
});

test('enabling after the last reminder schedules only the event alert', () => {
  const now = opens - 30_000;
  const armed = armAlerts(null, scheduleAt(now), subscription, now);

  assert.deepEqual(
    armed.queue.map(delivery => delivery.due),
    [opens],
  );
});

test('classifies push service responses', () => {
  assert.equal(pushOutcome(201), 'delivered');
  assert.equal(pushOutcome(410), 'gone');
  assert.equal(pushOutcome(404), 'gone');
  assert.equal(pushOutcome(429), 'retry');
  assert.equal(pushOutcome(503), 'retry');
  assert.equal(pushOutcome(403), 'rejected');
  assert.equal(pushOutcome(400), 'rejected');
});
