import { COUNTIES } from './county-data.js';
import { HOURS } from './hours-data.js';

export const OFFSETS = { A: 0, B: 4, C: 8, D: 12, E: 16, F: 20 };
export const MERIDIANS = [-92, -91, -90, -89, -88];
export const AREAS = { north: 'Northern', south: 'Southern' };
export const DATES = Object.keys(HOURS);
export const FIRST_DATE = DATES[0];
export const LAST_DATE = DATES.at(-1);

// Northern counties in Wis. Admin. Code NR 10.06(2)(a), including its southern edge.
const northern = new Set([
  'Ashland', 'Barron', 'Bayfield', 'Burnett', 'Chippewa', 'Clark', 'Door', 'Douglas',
  'Dunn', 'Eau Claire', 'Florence', 'Forest', 'Iron', 'Langlade', 'Lincoln', 'Marathon',
  'Marinette', 'Menominee', 'Oconto', 'Oneida', 'Pierce', 'Polk', 'Price', 'Rusk',
  'Sawyer', 'Shawano', 'St. Croix', 'Taylor', 'Vilas', 'Washburn',
]);

export const countyShapes = COUNTIES.map(([name, polygons]) => {
  const points = polygons.flat(2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    name,
    area: northern.has(name) ? 'north' : 'south',
    polygons,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
});

const wisconsinDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function wisconsinDate(now = new Date()) {
  const parts = Object.fromEntries(wisconsinDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dailyHours(date, selection) {
  if (!Object.hasOwn(HOURS, date) || !selection) return null;
  const { area, zone } = selection;
  if (!Object.hasOwn(AREAS, area) || !Object.hasOwn(OFFSETS, zone)) return null;
  const row = HOURS[date];
  const index = area === 'north' ? 0 : 2;
  return { opens: row[index] + OFFSETS[zone], closes: row[index + 1] + OFFSETS[zone] };
}

export function clockParts(minutes) {
  const hour = Math.floor(minutes / 60);
  return { time: `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`, period: hour < 12 ? 'AM' : 'PM' };
}

function containsPoint(ring, x, y) {
  let inside = false;
  for (let i = 1; i < ring.length; i += 1) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    if ((y0 > y) !== (y1 > y) && x < x0 + (x1 - x0) * (y - y0) / (y1 - y0)) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToEdge(polygon, x, y, metersPerLongitude) {
  const metersPerLatitude = 111_320;
  let nearest = Infinity;
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      const dx = (x1 - x0) * metersPerLongitude;
      const dy = (y1 - y0) * metersPerLatitude;
      const px = (x - x0) * metersPerLongitude;
      const py = (y - y0) * metersPerLatitude;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
      nearest = Math.min(nearest, Math.hypot(px - t * dx, py - t * dy));
    }
  }
  return nearest;
}

export function locate(x, y, accuracy) {
  if (![x, y, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 5000) {
    return { error: 'accuracy' };
  }
  const matches = [];
  for (const county of countyShapes) {
    const [west, south, east, north] = county.bounds;
    if (x < west || x > east || y < south || y > north) continue;
    const polygon = county.polygons.find(
      ([outer, ...holes]) => containsPoint(outer, x, y) && !holes.some(hole => containsPoint(hole, x, y)),
    );
    if (polygon) matches.push({ county, polygon });
  }
  if (matches.length === 0) return { error: 'outside' };
  if (matches.length > 1) return { error: 'boundary' };
  const { county, polygon } = matches[0];
  const metersPerLongitude = 111_320 * Math.cos(y * Math.PI / 180);
  const meridianDistance = Math.min(...MERIDIANS.map(meridian => Math.abs(x - meridian))) * metersPerLongitude;
  // Allow room for generalized county geometry as well as reported GPS uncertainty.
  const nearCountyEdge = distanceToEdge(polygon, x, y, metersPerLongitude) <= accuracy + 2000;
  if (nearCountyEdge || meridianDistance <= Math.max(25, accuracy)) return { error: 'boundary' };
  const zone = 'FEDCBA'[MERIDIANS.filter(meridian => x > meridian).length];
  return { area: county.area, zone, county: county.name };
}
