import type { Point } from './area-data';
import { setupAlertControls } from './alert-controls';
import { $ } from './elements';
import {
  AREAS,
  FIRST_DATE,
  LAST_DATE,
  OFFSETS,
  clockParts,
  dailyHours,
  isArea,
  isLocationChoice,
  isZone,
  liveHours,
  locate,
  wisconsinDate,
  type LocationChoice,
  type LocationError,
} from './hours';
import { setupLocalNotificationTest } from './local-notification-test';
import { isOnMap, setupZoneMap, type DeviceLocation } from './zone-map';

type Selection = LocationChoice & { point?: Point };

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Navigator {
    getInstalledRelatedApps?(): Promise<{ platform: string }[]>;
    readonly standalone?: boolean;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const todayDate = $('today-date', HTMLTimeElement);
const sheetToggle = $('sheet-toggle', HTMLButtonElement);
const sheetHours = $('sheet-hours');
const sheetDetails = $('sheet-details');
const hoursPanel = $('hours-panel');
const gpsButton = $('gps', HTMLButtonElement);
const zoneDialog = $('zone-dialog', HTMLDialogElement);
const areaInput = $('area', HTMLSelectElement);
const zoneInput = $('zone', HTMLSelectElement);
const scheduleStatus = $('schedule-status');
const scheduleAnnouncement = $('schedule-announcement');
const statusHeading = $('status-heading');
const statusMessage = $('status-message');
const liveToggle = $('toggle-live', HTMLButtonElement);
const storageKey = 'field-hours.location';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const coverageFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const boundaryMessages = {
  accuracy: 'Location accuracy is too low. Try GPS again or choose your zone.',
  boundary: 'This point is near a boundary. Confirm your area and zone on the DNR map.',
  outside:
    'This point couldn’t be placed inside Wisconsin. Try another location or choose your zone.',
} satisfies Record<LocationError, string>;

let selection = loadLocation();
let today = wisconsinDate();
let showLive = true;
let locating = false;
let deviceLocation: DeviceLocation | null = null;
let alertsArmed = false;

function loadLocation(): Selection | null {
  try {
    const stored = localStorage.getItem(storageKey);

    if (stored === null) return null;
    const saved: unknown = JSON.parse(stored);

    if (isLocationChoice(saved)) {
      const { area, zone } = saved;

      return { area, zone };
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }

  return null;
}

function useLocation(choice: LocationChoice, point?: Point) {
  selection = { ...choice, point };
  const { area, zone } = choice;

  try {
    localStorage.setItem(storageKey, JSON.stringify({ area, zone }));
  } catch {
    // The current choice still works for this session.
  }

  locationMessage('');
  renderLocation();
  renderHours();
  renderAlerts(selection);
}

function locationMessage(message: string) {
  $('location-message').textContent = message;
}

function reportLocationFailure(message: string) {
  const previous = selection ? ' Today’s hours still use the area and zone shown above.' : '';
  locationMessage(message + previous);
}

function writeTime(id: 'opening' | 'closing', value: number) {
  const parts = clockParts(value);
  $(id).textContent = parts.time;
  $(`${id}-period`).textContent = parts.period;
}

function setScheduleStatus(
  state: 'unavailable' | 'waiting' | 'within' | 'closed',
  heading: string,
  message: string,
) {
  if (statusMessage.textContent !== message) statusMessage.textContent = message;

  if (scheduleStatus.dataset.state === state) return;
  statusMessage.hidden = !message;
  scheduleStatus.dataset.state = state;
  statusHeading.textContent = heading;
  scheduleAnnouncement.textContent = message ? `${heading}. ${message}` : heading;
}

function minuteLabel(minutes: number) {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function durationLabel(totalMinutes: number) {
  if (totalMinutes < 60) return minuteLabel(totalMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;

  return minutes === 0 ? hourLabel : `${hourLabel} ${minuteLabel(minutes)}`;
}

function renderLiveHours(now: Date) {
  if (!selection) return;
  const status = liveHours(selection, now);

  if (!status) return;

  if (status.state === 'waiting') {
    setScheduleStatus(
      status.state,
      'Before scheduled hours',
      `Opens in ${durationLabel(status.minutes)}.`,
    );
  } else if (status.state === 'within') {
    const remaining = status.minutes === 0 ? 'Less than 1 minute' : durationLabel(status.minutes);
    setScheduleStatus(status.state, 'Within scheduled hours', `${remaining} remaining.`);
  } else {
    setScheduleStatus('closed', 'Closed for today', '');
  }
}

function renderHours(now = new Date()) {
  today = wisconsinDate(now);
  todayDate.dateTime = today;
  todayDate.textContent = dateFormat.format(new Date(`${today}T00:00:00Z`));
  const hours = dailyHours(today, selection);
  const unavailable = today < FIRST_DATE || today > LAST_DATE || (selection !== null && !hours);
  hoursPanel.hidden = !hours;
  liveToggle.hidden = !hours;
  scheduleStatus.hidden = !unavailable && (!hours || !showLive);

  if (hours) {
    writeTime('opening', hours.opens);
    writeTime('closing', hours.closes);
  }

  if (scheduleStatus.hidden) {
    delete scheduleStatus.dataset.state;
    scheduleAnnouncement.textContent = '';
  } else if (unavailable) {
    setScheduleStatus(
      'unavailable',
      'Hours unavailable today',
      'Check the Wisconsin DNR schedule.',
    );
  } else {
    renderLiveHours(now);
  }
}

function renderMap() {
  const location = deviceLocation && isOnMap(deviceLocation.point) ? deviceLocation : null;
  $('device-key').hidden = !location;
  $('selection-key').hidden = !selection?.point;
  updateMap(selection, location, alertsArmed);
}

function renderLocation() {
  if (selection) {
    const { area, zone } = selection;
    const detail = $('location-detail');
    const text = `${AREAS[area]} area · Zone ${zone} (+${OFFSETS[zone]} min)`;

    if (detail.textContent !== text) detail.textContent = text;
  }

  gpsButton.setAttribute('aria-disabled', String(locating));
  $('gps-label').textContent = locating ? 'Finding location…' : 'Use my location';
  const deviceDetail = $('device-detail');
  deviceDetail.hidden = !deviceLocation;

  if (deviceLocation) {
    const meters = Math.ceil(deviceLocation.accuracy);
    const radius = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
    deviceDetail.textContent = `Your device reported an accuracy radius of ${radius}.`;
  }

  renderMap();
}

gpsButton.addEventListener('click', () => {
  if (locating) return;

  if (!navigator.geolocation) {
    reportLocationFailure('Device location is unavailable. Choose your zone manually.');

    return;
  }

  const selectedAtStart = selection;
  locating = true;
  locationMessage('');
  renderLocation();
  navigator.geolocation.getCurrentPosition(
    position => {
      const { longitude, latitude, accuracy } = position.coords;
      const point: Point = [longitude, latitude];
      const canUseFix = [longitude, latitude, accuracy].every(Number.isFinite) && accuracy >= 0;
      deviceLocation = canUseFix ? { point, accuracy } : null;
      locating = false;
      const useForZone = selection === selectedAtStart;

      if (!useForZone) {
        renderLocation();

        return;
      }

      const choice = locate(longitude, latitude, accuracy);

      if ('error' in choice) {
        renderLocation();
        reportLocationFailure(boundaryMessages[choice.error]);
      } else {
        useLocation(choice);
      }
    },
    error => {
      locating = false;
      deviceLocation = null;
      renderLocation();

      if (selection !== selectedAtStart) return;

      const message =
        error.code === 1
          ? 'Location access is off. Allow it in browser settings or choose your zone.'
          : 'GPS couldn’t get a fix. Try again or choose your zone.';

      reportLocationFailure(message);
    },
    { enableHighAccuracy: true, timeout: 16_000, maximumAge: 0 },
  );
});

const updateMap = setupZoneMap($('zone-map', HTMLCanvasElement), (point, accuracy) => {
  const choice = locate(...point, accuracy);

  if ('error' in choice) {
    reportLocationFailure(boundaryMessages[choice.error]);

    return;
  }

  useLocation(choice, point);
});

const renderAlerts = setupAlertControls(armed => {
  alertsArmed = armed;
  renderMap();
});

$('manual').addEventListener('click', () => {
  areaInput.value = selection?.area ?? '';
  zoneInput.value = selection?.zone ?? '';
  zoneDialog.showModal();
});

$('zone-form').addEventListener('submit', event => {
  event.preventDefault();
  const area = areaInput.value;
  const zone = zoneInput.value;

  if (!isArea(area) || !isZone(zone)) return;
  zoneDialog.close();
  useLocation({ area, zone });
});

document.querySelectorAll<HTMLButtonElement>('button[data-close]').forEach(button => {
  const dialogId = button.dataset.close;

  if (dialogId) button.addEventListener('click', () => $(dialogId, HTMLDialogElement).close());
});

sheetToggle.addEventListener('click', () => {
  const expanded = sheetDetails.hidden;
  sheetDetails.hidden = !expanded;
  sheetHours.hidden = !expanded;
  sheetToggle.setAttribute('aria-expanded', String(expanded));
  $('sheet-toggle-label').textContent = expanded ? 'Hide details' : 'Show details';
});

function updateToday() {
  const now = new Date();
  const current = wisconsinDate(now);

  if (current !== today) renderHours(now);
  else if (!liveToggle.hidden && showLive) renderLiveHours(now);
  renderAlerts(selection, now);
}

liveToggle.addEventListener('click', () => {
  showLive = !showLive;
  liveToggle.setAttribute('aria-expanded', String(showLive));
  liveToggle.textContent = showLive ? 'Hide live status' : 'Show live status';
  renderHours();
});

if ('serviceWorker' in navigator) {
  const workers = navigator.serviceWorker;
  let controller = workers.controller;
  let reloading = false;

  workers.addEventListener('controllerchange', () => {
    const nextController = workers.controller;

    if (!nextController || nextController === controller || reloading) return;
    const isUpdate = controller !== null;
    controller = nextController;

    // The first worker can claim this page without replacing a running release.
    if (!isUpdate || import.meta.env.DEV) return;

    const reloadWhenActivated = () => {
      if (
        nextController.state !== 'activated' ||
        workers.controller !== nextController ||
        reloading
      )
        return;

      reloading = true;
      window.location.reload();
    };

    nextController.addEventListener('statechange', reloadWhenActivated);
    reloadWhenActivated();
  });

  void workers
    .register('./sw.js', { updateViaCache: 'none' })
    .then(registration => {
      function checkForUpdate() {
        if (!registration.active || registration.installing) return;

        void registration.update().catch(() => {
          // Keep using the installed release if the server is unreachable.
        });
      }

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForUpdate();
      });
      window.addEventListener('online', checkForUpdate);
      checkForUpdate();
    })
    .catch(error => {
      console.warn('Offline download unavailable.', error);
    });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateToday();
});

setInterval(() => {
  if (!document.hidden) updateToday();
}, 1000);

async function setupInstallBanner() {
  const isPhone = /\biPhone\b|\bAndroid\b.*\bMobile\b/.test(navigator.userAgent);

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);

  if (!isPhone || isStandalone) return;

  let installPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });

  const dismissalKey = 'field-hours.install-dismissed';

  try {
    if (localStorage.getItem(dismissalKey) === 'true') return;
  } catch {
    // The banner still works when storage is unavailable.
  }

  const banner = $('install-banner');
  const installDialog = $('install-dialog', HTMLDialogElement);
  let closed = false;

  function hideBanner() {
    closed = true;
    installPrompt = null;
    const hadFocus = banner.contains(document.activeElement);
    banner.hidden = true;

    if (hadFocus) $('main').focus({ preventScroll: true });
  }

  window.addEventListener('appinstalled', hideBanner);

  $('dismiss-install').addEventListener('click', () => {
    hideBanner();

    try {
      localStorage.setItem(dismissalKey, 'true');
    } catch {
      // The banner stays dismissed on this page.
    }
  });

  $('install').addEventListener('click', async () => {
    if (!installPrompt) {
      installDialog.showModal();

      return;
    }

    const prompt = installPrompt;
    installPrompt = null;

    try {
      const { outcome } = await prompt.prompt();

      if (outcome === 'accepted') hideBanner();
    } catch {
      if (!closed) installDialog.showModal();
    }
  });

  try {
    const apps = await navigator.getInstalledRelatedApps?.();

    if (apps?.some(app => app.platform === 'webapp')) return;
  } catch {
    // Installation instructions are still available when the browser cannot check.
  }

  if (!closed) banner.hidden = false;
}

void setupInstallBanner();

const firstDay = coverageFormat.format(new Date(`${FIRST_DATE}T00:00:00Z`));
const lastDay = coverageFormat.format(new Date(`${LAST_DATE}T00:00:00Z`));

$('coverage').textContent = `Bundled hours cover ${firstDay} through ${lastDay}.`;

renderLocation();

renderHours();

renderAlerts(selection);

setupLocalNotificationTest();
