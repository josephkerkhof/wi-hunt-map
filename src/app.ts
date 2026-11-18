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
  offsetDate,
  wisconsinDate,
  type LocationChoice,
  type LocationError,
} from './hours';
import { setupZoneMap } from './zone-map';

type Selection = LocationChoice & {
  source: 'Saved location' | 'GPS' | 'Map selection' | 'Manual selection';
  point?: Point;
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
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

const dateInput = $('date', HTMLInputElement);
const gpsButton = $('gps', HTMLButtonElement);
const zoneDialog = $('zone-dialog', HTMLDialogElement);
const areaInput = $('area', HTMLSelectElement);
const zoneInput = $('zone', HTMLSelectElement);
const installDialog = $('install-dialog', HTMLDialogElement);
const scheduleStatus = $('schedule-status');
const scheduleAnnouncement = $('schedule-announcement');
const statusHeading = $('status-heading');
const statusMessage = $('status-message');
const liveToggle = $('toggle-live', HTMLButtonElement);
const storageKey = 'field-hours.location';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const coverageFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const mapHint = 'Select a spot on the map or choose a zone manually.';

const boundaryMessages = {
  accuracy: 'Location accuracy is too low. Try GPS again or choose your zone.',
  boundary: 'This point is near a boundary. Confirm your area and zone on the DNR map.',
  outside:
    'This point couldn’t be placed inside Wisconsin. Try another location or choose your zone.',
} satisfies Record<LocationError, string>;

let selection = loadLocation();
let today = wisconsinDate();
let date = today;
let showLive = true;
let locating = false;
let locationRequest = 0;
let installPrompt: BeforeInstallPromptEvent | null = null;

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

      return { area, zone, county, source: 'Saved location' };
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }

  return null;
}

function useLocation(choice: LocationChoice, source: Selection['source'], point?: Point) {
  selection = { ...choice, source, point };
  const { area, zone, county } = choice;

  try {
    localStorage.setItem(storageKey, JSON.stringify({ area, zone, county }));
  } catch {
    // The current choice still works for this session.
  }

  locationMessage('');
  $('map-guide').textContent = mapHint;
  renderLocation();
  renderHours();
}

function locationMessage(message: string) {
  $('location-message').textContent = message;
}

function reportLocationFailure(message: string) {
  const previous = selection ? ' The window still uses the location shown above.' : '';
  locationMessage(message + previous);
}

function shiftDate(days: -1 | 1) {
  if (days < 0 && date <= FIRST_DATE) return;

  if (days > 0 && date >= LAST_DATE) return;

  if (date > LAST_DATE && days < 0) return setDate(LAST_DATE);

  if (date < FIRST_DATE && days > 0) return setDate(FIRST_DATE);
  setDate(offsetDate(date, days));
}

function setDate(value: string) {
  date = value;
  renderHours();
}

function writeTime(id: 'opening' | 'closing', value: number | undefined) {
  const parts = value === undefined ? { time: '—', period: '' } : clockParts(value);
  $(id).textContent = parts.time;
  $(`${id}-period`).textContent = parts.period;
}

function setScheduleStatus(
  state: 'location' | 'unavailable' | 'waiting' | 'within' | 'closed',
  heading: string,
  message: string,
) {
  if (statusMessage.textContent !== message) statusMessage.textContent = message;

  if (scheduleStatus.dataset.state === state) return;
  $('status-location').hidden = state !== 'location';
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
  const { state, minutes } = status;

  if (state === 'waiting') {
    setScheduleStatus(state, 'Before scheduled hours', `Opens in ${minuteLabel(minutes)}.`);
  } else if (state === 'within') {
    const remaining = minutes === 0 ? 'Less than 1 minute' : minuteLabel(minutes);
    setScheduleStatus(state, 'Within scheduled hours', `${remaining} remaining.`);
  } else {
    const next =
      minutes === null
        ? 'The bundled schedule ends today.'
        : `Tomorrow’s scheduled hours open in ${minuteLabel(minutes)}.`;

    setScheduleStatus('closed', 'Closed for today', next);
  }
}

function renderHours(now = new Date()) {
  const selected = $('selected-date', HTMLTimeElement);
  selected.dateTime = date;
  const dateLabel = dateFormat.format(new Date(`${date}T00:00:00Z`));

  if (selected.textContent !== dateLabel) selected.textContent = dateLabel;
  const covered = date >= FIRST_DATE && date <= LAST_DATE;
  dateInput.value = covered ? date : '';
  $('previous').setAttribute('aria-disabled', String(date <= FIRST_DATE));
  $('next').setAttribute('aria-disabled', String(date >= LAST_DATE));
  $('today').setAttribute('aria-current', date === today ? 'date' : 'false');

  const hours = dailyHours(date, selection);
  writeTime('opening', hours?.opens);
  writeTime('closing', hours?.closes);
  $('hours-panel').setAttribute('aria-hidden', String(!hours));
  $('time-context').textContent = selection
    ? `${AREAS[selection.area]} area · Zone ${selection.zone} · Central time`
    : 'Wisconsin Central time';

  const live = date === today && hours !== null;
  liveToggle.hidden = !live;
  scheduleStatus.hidden = hours !== null && (!live || !showLive);

  if (scheduleStatus.hidden) {
    scheduleAnnouncement.textContent = '';
  } else if (!covered || (selection && !hours)) {
    setScheduleStatus(
      'unavailable',
      'Hours unavailable',
      'The bundled DNR tables do not cover this date.',
    );
  } else if (!selection) {
    setScheduleStatus('location', 'Location needed', '');
  } else if (live) {
    renderLiveHours(now);
  }
}

function renderLocation() {
  if (selection) {
    const { county, area, zone, source } = selection;
    const place = county ? `${county} County · ` : '';
    const detail = $('location-detail');
    const text = `${place}${AREAS[area]} area · Zone ${zone} · ${source}`;

    if (detail.textContent !== text) detail.textContent = text;
  }

  gpsButton.setAttribute('aria-disabled', String(locating));
  $('gps-label').textContent = locating ? 'Finding location…' : 'Use my location';
  updateMap(selection);
}

function finishGps(request: number) {
  if (request !== locationRequest) return false;
  locating = false;
  renderLocation();

  return true;
}

gpsButton.addEventListener('click', () => {
  if (locating) return;

  if (!navigator.geolocation) {
    reportLocationFailure('Device location is unavailable. Choose your zone manually.');

    return;
  }

  const request = ++locationRequest;
  locating = true;
  locationMessage('');
  renderLocation();
  navigator.geolocation.getCurrentPosition(
    position => {
      if (!finishGps(request)) return;
      const { longitude, latitude, accuracy } = position.coords;
      const choice = locate(longitude, latitude, accuracy);

      if ('error' in choice) reportLocationFailure(boundaryMessages[choice.error]);
      else useLocation(choice, 'GPS', [longitude, latitude]);
    },
    error => {
      if (!finishGps(request)) return;

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
    $('map-guide').textContent = boundaryMessages[choice.error];

    return;
  }

  locationRequest += 1;
  locating = false;
  useLocation(choice, 'Map selection', point);
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
  locationRequest += 1;
  locating = false;
  zoneDialog.close();
  useLocation({ area, zone }, 'Manual selection');
});

document.querySelectorAll<HTMLButtonElement>('button[data-close]').forEach(button => {
  const dialogId = button.dataset.close;

  if (dialogId) button.addEventListener('click', () => $(dialogId, HTMLDialogElement).close());
});

$('previous').addEventListener('click', () => shiftDate(-1));

$('next').addEventListener('click', () => shiftDate(1));

$('today').addEventListener('click', () => {
  today = wisconsinDate();
  setDate(today);
});

dateInput.addEventListener('change', () => {
  const { value } = dateInput;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value);
  else dateInput.value = date;
});

function updateToday() {
  const now = new Date();
  const current = wisconsinDate(now);

  if (current === today) {
    if (!liveToggle.hidden && showLive) renderLiveHours(now);

    return;
  }

  if (date === today) date = current;
  today = current;
  renderHours(now);
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

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  $('install').hidden = true;
});

$('install').hidden =
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && navigator.standalone === true);

$('install').addEventListener('click', async () => {
  if (!installPrompt) {
    installDialog.showModal();

    return;
  }

  const prompt = installPrompt;
  installPrompt = null;

  try {
    await prompt.prompt();
  } catch {
    installDialog.showModal();
  }
});

dateInput.min = FIRST_DATE;

dateInput.max = LAST_DATE;

const firstDay = coverageFormat.format(new Date(`${FIRST_DATE}T00:00:00Z`));
const lastDay = coverageFormat.format(new Date(`${LAST_DATE}T00:00:00Z`));

$('coverage').textContent = `Bundled hours cover ${firstDay} through ${lastDay}.`;

renderLocation();

renderHours();
