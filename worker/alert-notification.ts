import { MINUTE_MS, type AlertSchedule } from '../src/alerts';
import { AREAS } from '../src/hours';

const eventTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

/** The tag is also the push Topic, so a retried alert replaces the first copy. */
export const alertTag = (due: number) => `field-hours-${due}`;

export function alertNotification(schedule: AlertSchedule, due: number) {
  const { area, zone, event } = schedule;
  const opening = event.kind === 'opening';
  const minutes = (event.at - due) / MINUTE_MS;

  const title =
    minutes === 0
      ? `Shooting hours have ${opening ? 'started' : 'ended'}`
      : `Shooting hours ${opening ? 'open' : 'close'} in ${minutes} min`;

  return {
    title,
    body: `${eventTime.format(event.at)} CT · ${AREAS[area]} Zone ${zone}`,
    tag: alertTag(due),
  };
}
