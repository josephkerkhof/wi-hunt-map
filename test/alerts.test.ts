import assert from 'node:assert/strict';
import { test } from 'vitest';
import { nextShootingEvent, reminderTimes } from '../src/alerts';
import { LocalNotificationTest } from '../worker/local-notification-test';

const location = { area: 'north', zone: 'A' } as const;

test('selects only opening before dawn and only closing during shooting hours', () => {
  const morning = nextShootingEvent(location, new Date('2026-11-21T11:45:00Z'));
  const afternoon = nextShootingEvent(location, new Date('2026-11-21T21:30:00Z'));

  assert.deepEqual(morning, { kind: 'opening', at: Date.parse('2026-11-21T12:28:00Z') });
  assert.deepEqual(afternoon, { kind: 'closing', at: Date.parse('2026-11-21T22:34:00Z') });
});

test('after closing, selects tomorrow’s opening across the clock change', () => {
  const date = new Date('2026-10-31T22:58:00Z');
  const acrossMidnight = new Date('2026-11-01T05:00:00Z');

  assert.deepEqual(nextShootingEvent(location, date), {
    kind: 'opening',
    at: Date.parse('2026-11-01T12:00:00Z'),
  });
  assert.deepEqual(nextShootingEvent(location, date), nextShootingEvent(location, acrossMidnight));
  assert.equal(nextShootingEvent(location, new Date('2027-02-01T00:00:00Z')), null);
});

test('keeps only future reminders for the same next event', () => {
  const opens = Date.parse('2026-11-21T12:28:00Z');
  const now = Date.parse('2026-11-21T12:00:00Z');
  const event = nextShootingEvent(location, new Date(now));
  assert.ok(event);
  assert.deepEqual(
    reminderTimes(event, now).map(at => (opens - at) / 60_000),
    [10, 5, 3, 1],
  );
  assert.deepEqual(
    reminderTimes(event, opens - 4 * 60_000).map(at => (opens - at) / 60_000),
    [3, 1],
  );
  assert.deepEqual(reminderTimes(event, opens - 1000), []);
  assert.deepEqual(nextShootingEvent(location, new Date(opens - 1000)), event);
  assert.equal(nextShootingEvent(location, new Date(opens))?.kind, 'closing');
});

test('an app without event title support gets a reload error before an event test is queued', async () => {
  const localTest = new LocalNotificationTest();
  const device = crypto.randomUUID();
  const origin = 'http://127.0.0.1:4173';
  const url = origin + '/api/alerts/test';
  const token = 'test-token';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const poll = await localTest.fetch(
    new Request(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ device, origin, reply: '' }),
    }),
    token,
  );

  assert.equal(poll.status, 200);

  const eventTest = await localTest.fetch(
    new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ device, event: 'opening' }),
    }),
    token,
  );

  assert.equal(eventTest.status, 409);
  assert.deepEqual(await eventTest.json(), {
    message: 'Reopen Field Hours to load the updated app, then try the event test again.',
  });
});
