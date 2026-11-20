import assert from 'node:assert/strict';
import { test } from 'vitest';
import { nextShootingEvent, reminderTimes } from '../src/alerts';

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
