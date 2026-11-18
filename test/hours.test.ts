import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  DATES,
  OFFSETS,
  ZONES_WEST_TO_EAST,
  clockParts,
  dailyHours,
  locate,
  wisconsinDate,
} from '../src/hours';

test('uses the published open and close times for both areas and all six offsets', () => {
  for (const zone of ZONES_WEST_TO_EAST) {
    const offset = OFFSETS[zone];
    assert.deepEqual(dailyHours('2026-11-21', { area: 'north', zone }), {
      opens: 388 + offset,
      closes: 994 + offset,
    });
    assert.deepEqual(dailyHours('2026-11-21', { area: 'south', zone }), {
      opens: 383 + offset,
      closes: 1000 + offset,
    });
  }

  assert.deepEqual(clockParts(1008), { time: '4:48', period: 'PM' });
});

test('preserves the table’s daylight saving switch and January 2027 rows', () => {
  const choice = { area: 'north', zone: 'A' } as const;
  assert.deepEqual(dailyHours('2026-10-31', choice), { opens: 419, closes: 1078 });
  assert.deepEqual(dailyHours('2026-11-01', choice), { opens: 360, closes: 1017 });
  assert.deepEqual(dailyHours('2027-01-31', choice), { opens: 403, closes: 1035 });
  assert.equal(wisconsinDate(new Date('2026-11-21T05:59:59Z')), '2026-11-20');
  assert.equal(wisconsinDate(new Date('2026-11-21T06:00:00Z')), '2026-11-21');
  assert.equal(wisconsinDate(new Date('2026-09-12T05:00:00Z')), '2026-09-12');
});

test('the table has no gaps and never extrapolates', () => {
  assert.equal(DATES.length, 153);
  const start = Date.parse('2026-09-01');

  for (const [index, date] of DATES.entries()) {
    assert.equal(Date.parse(date), start + index * 86_400_000);

    for (const area of ['north', 'south'] as const) {
      const hours = dailyHours(date, { area, zone: 'F' });
      assert.ok(hours);
      const { opens, closes } = hours;
      assert.ok(0 < opens && opens < 720 && 720 < closes && closes < 1440);
    }
  }

  const choice = { area: 'north', zone: 'F' } as const;
  assert.equal(dailyHours('2026-08-31', choice), null);
  assert.equal(dailyHours('2027-02-01', choice), null);
  assert.equal(dailyHours('2026-11-21', null), null);
});

test('uses county boundaries for area and GPS longitude for zone', () => {
  assert.deepEqual(locate(-89.4012, 43.0731, 30), { area: 'south', zone: 'C', county: 'Dane' });
  assert.deepEqual(locate(-89.6301, 44.9591, 30), { area: 'north', zone: 'C', county: 'Marathon' });
  assert.deepEqual(locate(-92.4874, 44.7322, 30), { area: 'north', zone: 'F', county: 'Pierce' });
  assert.deepEqual(locate(-91.4846, 46.013, 30), { area: 'north', zone: 'E', county: 'Sawyer' });
  assert.deepEqual(locate(-88.021, 44.5133, 30), { area: 'south', zone: 'B', county: 'Brown' });
});

test('does not assign uncertain or out-of-state positions', () => {
  assert.deepEqual(locate(-90, 44.02, 30), { error: 'boundary' });
  assert.deepEqual(locate(-89.4012, 43.0731, 10_000), { error: 'accuracy' });
  assert.deepEqual(locate(-89.4, 42.45, 30), { error: 'outside' });
});
