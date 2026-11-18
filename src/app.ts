import type { Point } from './county-data';
import {
  AREAS,
  FIRST_DATE,
  LAST_DATE,
  clockParts,
  dailyHours,
  isArea,
  isZone,
  liveHours,
  locate,
  wisconsinDate,
  type LocationChoice,
  type LocationError,
} from './hours';
import { isOnMap, setupZoneMap, type DeviceLocation } from './zone-map';

type Selection = LocationChoice & { point?: Point };

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Navigator {
    getInstalledRelatedApps?(): Promise<{ platform: string }[]>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

function $(id: string): HTMLElement;
function $<T extends HTMLElement>(id: string, type: new () => T): T;
function $(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const node = document.getElementById(id);

  if (!(node instanceof type)) throw new Error(`Missing or unexpected element #${id}`);

  return node;
}

const todayDate = $('today-date', HTMLTimeElement);
const sheetToggle = $('sheet-toggle', HTMLButtonElement);
const sheetHours = $('sheet-hours');
const sheetDetails = $('sheet-details');
const hoursPanel = $('hours-panel');
const gpsButton = $('gps', HTMLButtonElement);
const mapView = $('map-view', HTMLButtonElement);
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
let centeredOnDevice = false;

function isStoredLocation(value: unknown): value is LocationChoice {
  return (
    typeof value === 'object' &&
    value !== null &&
    'area' in value &&
    isArea(value.area) &&
    'zone' in value &&
    isZone(value.zone) &&
    (!('county' in value) || typeof value.county === 'string')
  );
}

function loadLocation(): Selection | null {
  try {
    const stored = localStorage.getItem(storageKey);

    if (stored === null) return null;
    const saved: unknown = JSON.parse(stored);

    if (isStoredLocation(saved)) {
      const { area, zone, county } = saved;

      return { area, zone, county };
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }

  return null;
}

function useLocation(choice: LocationChoice, point?: Point) {
  selection = { ...choice, point };
  const { area, zone, county } = choice;

  try {
    localStorage.setItem(storageKey, JSON.stringify({ area, zone, county }));
  } catch {
    // The current choice still works for this session.
  }

  locationMessage('');
  renderLocation();
  renderHours();
}

function locationMessage(message: string) {
  $('location-message').textContent = message;
}

function reportLocationFailure(message: string) {
  const previous = selection ? ' Today’s hours still use the selected zone shown above.' : '';
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

function renderLiveHours(now: Date) {
  if (!selection) return;
  const status = liveHours(selection, now);

  if (!status) return;

  if (status.state === 'waiting') {
    setScheduleStatus(
      status.state,
      'Before scheduled hours',
      `Opens in ${minuteLabel(status.minutes)}.`,
    );
  } else if (status.state === 'within') {
    const remaining = status.minutes === 0 ? 'Less than 1 minute' : minuteLabel(status.minutes);
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
  mapView.hidden = !location;
  mapView.textContent = centeredOnDevice ? 'All zones' : 'Center on me';
  updateMap(selection, location, centeredOnDevice);
}

function renderLocation() {
  if (selection) {
    const { county, area, zone } = selection;
    const place = county ? `${county} County · ` : '';
    const detail = $('location-detail');
    const text = `${place}${AREAS[area]} area · Zone ${zone}`;

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
      centeredOnDevice = useForZone && canUseFix && isOnMap(point);

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
      centeredOnDevice = false;
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

mapView.addEventListener('click', () => {
  centeredOnDevice = !centeredOnDevice;
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
}

liveToggle.addEventListener('click', () => {
  showLive = !showLive;
  liveToggle.setAttribute('aria-expanded', String(showLive));
  liveToggle.textContent = showLive ? 'Hide live status' : 'Show live status';
  renderHours();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => {
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
