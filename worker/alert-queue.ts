import type { PushSubscription } from 'web-push';
import { MINUTE_MS, reminderTimes, type AlertSchedule } from '../src/alerts';

/** One notification to send at `due` for the event in `schedule`. */
export interface Delivery {
  due: number;
  schedule: AlertSchedule;
}

export interface ArmedAlerts {
  /** The most recently enabled set. The app shows it as active until its event. */
  schedule: AlertSchedule;
  subscription: PushSubscription;
  /** Deliveries that have not been sent, sorted by due time. */
  queue: Delivery[];
}

export type PushOutcome = 'delivered' | 'gone' | 'retry' | 'rejected';

export interface AlarmPlan {
  /** The record to store, or null to clear the device. */
  record: ArmedAlerts | null;
  alarm: number | null;
  send: Delivery | null;
  expired: Delivery[];
}

/** A delivery is useful for one minute after it is due. */
export const deliveryExpires = (delivery: Delivery) => delivery.due + MINUTE_MS;

/** Wait before retrying a delivery whose outcome is unknown or temporarily refused. */
export const RETRY_MS = 15_000;

export function sameDelivery(a: Delivery, b: Delivery) {
  return (
    a.due === b.due &&
    a.schedule.event.at === b.schedule.event.at &&
    a.schedule.area === b.schedule.area &&
    a.schedule.zone === b.schedule.zone
  );
}

function deliveries(schedule: AlertSchedule, dues: number[]) {
  return dues.map(due => ({ due, schedule }));
}

/** The first release kept reminders in `pending` and set it to null after claiming the final alert. */
interface LegacyArmedAlerts {
  id: string;
  schedule: AlertSchedule;
  subscription: PushSubscription;
  pending: number[] | null;
}

export type StoredAlerts = ArmedAlerts | LegacyArmedAlerts;

/** Reads a stored record, including one written by the first release. */
export function readArmed(stored: StoredAlerts | undefined): ArmedAlerts | null {
  if (!stored?.schedule) return null;

  if ('queue' in stored) return stored;
  const { schedule, subscription, pending } = stored;
  const dues = pending === null ? [] : [...pending, schedule.event.at];

  return { schedule, subscription, queue: deliveries(schedule, dues) };
}

/**
 * Arms a new set. A final alert from the previous set that is still deliverable stays queued.
 */
export function armAlerts(
  current: ArmedAlerts | null,
  schedule: AlertSchedule,
  subscription: PushSubscription,
  now: number,
): ArmedAlerts {
  const carried = (current?.queue ?? []).filter(
    delivery => delivery.schedule.event.at <= now && deliveryExpires(delivery) > now,
  );

  const queue = [
    ...carried,
    ...deliveries(schedule, [...reminderTimes(schedule.event, now), schedule.event.at]),
  ].sort((a, b) => a.due - b.due);

  return { schedule, subscription, queue };
}

/**
 * Chooses what an alarm sends. A late alarm sends the most recent due delivery,
 * which replaces older ones. The delivery stays queued with a retry alarm until
 * its outcome is recorded, so an interrupted send is retried before it expires.
 */
export function planAlarm(record: ArmedAlerts, now: number): AlarmPlan {
  const expired = record.queue.filter(delivery => deliveryExpires(delivery) <= now);
  const live = record.queue.filter(delivery => deliveryExpires(delivery) > now);
  const send = live.filter(delivery => delivery.due <= now).at(-1) ?? null;
  const queue = live.filter(delivery => delivery.due > now || delivery === send);

  if (queue.length === 0) return { record: null, alarm: null, send: null, expired };
  const next = queue.find(delivery => delivery.due > now)?.due ?? Infinity;
  const alarm = send ? Math.min(now + RETRY_MS, next) : next;

  return { record: { ...record, queue }, alarm, send, expired };
}

/** Records a delivery's outcome. Returns undefined when the record should stay unchanged. */
export function completeDelivery(
  record: ArmedAlerts,
  delivery: Delivery,
  outcome: PushOutcome,
): { record: ArmedAlerts | null; alarm: number | null } | undefined {
  if (outcome === 'retry' || !record.queue.some(queued => sameDelivery(queued, delivery))) {
    return undefined;
  }

  // The push service no longer accepts this subscription.
  if (outcome === 'gone') return { record: null, alarm: null };
  const queue = record.queue.filter(queued => !sameDelivery(queued, delivery));
  const next = queue[0];

  return next ? { record: { ...record, queue }, alarm: next.due } : { record: null, alarm: null };
}

export function pushOutcome(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'delivered';

  if (status === 404 || status === 410) return 'gone';

  if (status === 429 || status >= 500) return 'retry';

  return 'rejected';
}
