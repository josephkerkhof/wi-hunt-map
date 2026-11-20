import {
  dailyHours,
  isLocationChoice,
  scheduledTime,
  wisconsinDate,
  type LocationChoice,
} from './hours';

type ShootingEvent = { kind: 'opening' | 'closing'; at: number };

export type AlertSchedule = LocationChoice & { event: ShootingEvent };

export const MINUTE_MS = 60_000;
const reminderMinutes = [10, 5, 3, 1];
const dayMs = 86_400_000;

export function nextShootingEvent(location: LocationChoice, now: Date): ShootingEvent | null {
  const today = wisconsinDate(now);
  const hours = dailyHours(today, location);

  if (hours) {
    const opens = scheduledTime(today, hours.opens);
    const closes = scheduledTime(today, hours.closes);

    if (now.getTime() < opens) return { kind: 'opening', at: opens };

    if (now.getTime() < closes) return { kind: 'closing', at: closes };
  }

  const tomorrow = new Date(Date.parse(today) + dayMs).toISOString().slice(0, 10);
  const nextHours = dailyHours(tomorrow, location);

  return nextHours ? { kind: 'opening', at: scheduledTime(tomorrow, nextHours.opens) } : null;
}

export function reminderTimes(event: ShootingEvent, now: number) {
  return reminderMinutes.flatMap(minutes => {
    const at = event.at - minutes * MINUTE_MS;

    return at >= now ? [at] : [];
  });
}

export function isAlertSchedule(value: unknown): value is AlertSchedule {
  if (!isLocationChoice(value) || !('event' in value)) return false;
  const event = value.event;

  return (
    typeof event === 'object' &&
    event !== null &&
    'kind' in event &&
    (event.kind === 'opening' || event.kind === 'closing') &&
    'at' in event &&
    typeof event.at === 'number' &&
    Number.isSafeInteger(event.at) &&
    event.at > 0 &&
    event.at < 8.64e15
  );
}

export async function subscriptionToken(endpoint: string, auth: string) {
  const input = new TextEncoder().encode(`${endpoint}\n${auth}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));

  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
