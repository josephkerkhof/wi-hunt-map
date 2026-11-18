import { AREA_BOUNDARIES, type Area, type Ring } from './area-data';
import { HOURS } from './hours-data';

export const OFFSETS = { A: 0, B: 4, C: 8, D: 12, E: 16, F: 20 };
export const MERIDIANS = [-92, -91, -90, -89, -88];
export const AREAS = { north: 'Northern', south: 'Southern' } satisfies Record<Area, string>;
export const ZONES_WEST_TO_EAST = ['F', 'E', 'D', 'C', 'B', 'A'] as const satisfies readonly Zone[];

export type Zone = keyof typeof OFFSETS;

export type LocationChoice = { area: Area; zone: Zone };

export type LocationError = 'accuracy' | 'boundary' | 'outside';

export const DATES = Object.keys(HOURS);
const firstDate = DATES[0];
const lastDate = DATES.at(-1);

if (!firstDate || !lastDate) throw new Error('The shooting hours table is empty');

export const FIRST_DATE = firstDate;
export const LAST_DATE = lastDate;

const timeZone = 'America/Chicago';
const minuteMs = 60_000;
const metersPerLatitude = 111_320;

const wisconsinDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const wisconsinOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone,
  timeZoneName: 'longOffset',
});

export function wisconsinDate(now = new Date()) {
  const parts = Object.fromEntries(
    wisconsinDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isArea(value: unknown): value is Area {
  return typeof value === 'string' && Object.hasOwn(AREAS, value);
}

export function isZone(value: unknown): value is Zone {
  return typeof value === 'string' && Object.hasOwn(OFFSETS, value);
}

function hasHours(date: string): date is keyof typeof HOURS {
  return Object.hasOwn(HOURS, date);
}

export function dailyHours(date: string, selection: LocationChoice | null) {
  if (!hasHours(date) || !selection) return null;
  const { area, zone } = selection;

  if (!Object.hasOwn(AREAS, area) || !Object.hasOwn(OFFSETS, zone)) return null;
  const row = HOURS[date];
  const opens = row[area === 'north' ? 0 : 2];
  const closes = row[area === 'north' ? 1 : 3];
  const offset = OFFSETS[zone];

  return { opens: opens + offset, closes: closes + offset };
}

function scheduledTime(date: string, minutes: number) {
  // Published hours are after the early-morning clock change on daylight saving days.
  const midday = new Date(`${date}T18:00:00Z`);

  const offset = wisconsinOffsetFormatter
    .formatToParts(midday)
    .find(part => part.type === 'timeZoneName');

  if (!offset) throw new Error('Wisconsin time zone offset unavailable');

  return Date.parse(`${date}T00:00:00${offset.value.slice(3)}`) + minutes * minuteMs;
}

type LiveHours = { state: 'waiting' | 'within'; minutes: number } | { state: 'closed' };

export function liveHours(selection: LocationChoice, now = new Date()): LiveHours | null {
  const date = wisconsinDate(now);
  const hours = dailyHours(date, selection);

  if (!hours) return null;
  const opens = scheduledTime(date, hours.opens);
  const closes = scheduledTime(date, hours.closes);
  const current = now.getTime();

  if (current < opens) {
    return { state: 'waiting', minutes: Math.ceil((opens - current) / minuteMs) };
  }

  if (current < closes) {
    return { state: 'within', minutes: Math.floor((closes - current) / minuteMs) };
  }

  return { state: 'closed' };
}

export function clockParts(minutes: number) {
  const hour = Math.floor(minutes / 60);

  return {
    time: `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`,
    period: hour < 12 ? 'AM' : 'PM',
  };
}

function containsPoint(ring: Ring, x: number, y: number) {
  let inside = false;
  let [x0, y0] = ring[0];

  for (const [x1, y1] of ring.slice(1)) {
    if (y0 > y !== y1 > y && x < x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)) {
      inside = !inside;
    }

    x0 = x1;
    y0 = y1;
  }

  return inside;
}

function distanceToEdge(ring: Ring, x: number, y: number, metersPerLongitude: number) {
  let nearest = Infinity;
  let [x0, y0] = ring[0];

  for (const [x1, y1] of ring.slice(1)) {
    const dx = (x1 - x0) * metersPerLongitude;
    const dy = (y1 - y0) * metersPerLatitude;
    const px = (x - x0) * metersPerLongitude;
    const py = (y - y0) * metersPerLatitude;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(px - t * dx, py - t * dy));
    x0 = x1;
    y0 = y1;
  }

  return nearest;
}

export function locate(
  longitude: number,
  latitude: number,
  accuracy: number,
): LocationChoice | { error: LocationError } {
  if (![longitude, latitude, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 5000) {
    return { error: 'accuracy' };
  }

  for (const [area, rings] of AREA_BOUNDARIES) {
    const ring = rings.find(ring => containsPoint(ring, longitude, latitude));

    if (!ring) continue;

    const metersPerLongitude = metersPerLatitude * Math.cos((latitude * Math.PI) / 180);

    const meridianDistance =
      Math.min(...MERIDIANS.map(meridian => Math.abs(longitude - meridian))) * metersPerLongitude;

    // Allow room for generalized area edges as well as reported GPS uncertainty.
    const nearAreaEdge =
      distanceToEdge(ring, longitude, latitude, metersPerLongitude) <= accuracy + 2000;

    if (nearAreaEdge || meridianDistance <= Math.max(25, accuracy)) return { error: 'boundary' };

    const nextBoundary = MERIDIANS.findIndex(meridian => longitude < meridian);
    const zone = ZONES_WEST_TO_EAST[nextBoundary] ?? 'A';

    return { area, zone };
  }

  return { error: 'outside' };
}
