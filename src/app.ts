import type { Point } from './county-data';
import {
  AREAS,
  FIRST_DATE,
  LAST_DATE,
  OFFSETS,
  clockParts,
  dailyHours,
  isArea,
  isZone,
  locate,
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
const zoneDialog = $('zone-dialog', HTMLDialogElement);
const areaInput = $('area', HTMLSelectElement);
const zoneInput = $('zone', HTMLSelectElement);
const installDialog = $('install-dialog', HTMLDialogElement);
const storageKey = 'field-hours.location';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
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

const mapHint = 'Tap the map to select a location.';

const boundaryMessages = {
  accuracy: 'Location accuracy is too low. Try GPS again or choose your zone.',
  boundary: 'This point is near a boundary. Confirm your area and zone on the DNR map.',
  outside:
    'This point couldn’t be placed inside Wisconsin. Try another location or choose your zone.',
} satisfies Record<LocationError, string>;

let selection = loadLocation();
let today = wisconsinDate();
let date = today;
let locating = false;
let locationRequest = 0;
let installPrompt: BeforeInstallPromptEvent | null = null;
let offlineRequest = 0;

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
  $('location-message').hidden = !message;
  $('location-message').textContent = message;
}

function reportLocationFailure(message: string) {
  const previous = selection ? ' The window still uses the location shown above.' : '';
  locationMessage(message + previous);
}

function shiftDate(days: number) {
  if (date > LAST_DATE && days < 0) return setDate(LAST_DATE);

  if (date < FIRST_DATE && days > 0) return setDate(FIRST_DATE);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  setDate(day.toISOString().slice(0, 10));
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

function renderHours() {
  const selected = $('selected-date', HTMLTimeElement);
  selected.dateTime = date;
  selected.textContent = dateFormat.format(new Date(`${date}T00:00:00Z`));
  dateInput.value = date;
  $('previous', HTMLButtonElement).disabled = date <= FIRST_DATE;
  $('next', HTMLButtonElement).disabled = date >= LAST_DATE;
  $('today', HTMLButtonElement).disabled = date === today;

  const hours = dailyHours(date, selection);
  writeTime('opening', hours?.opens);
  writeTime('closing', hours?.closes);
  let context = 'Choose your location to see hours.';

  if (date < FIRST_DATE || date > LAST_DATE) {
    context = 'No DNR table is bundled for this date.';
  } else if (hours && selection) {
    const { area, zone } = selection;
    context = `${AREAS[area]} area · Zone ${zone} (+${OFFSETS[zone]} min) · Central time`;
  }

  $('time-context').textContent = context;
}

function renderLocation() {
  if (selection) {
    const { county, area, zone, source } = selection;
    const place = county ? `${county} County` : `${AREAS[area]} area`;
    $('location-detail').textContent = `${place} · Zone ${zone} · ${source}`;
  }

  $('gps', HTMLButtonElement).disabled = locating;
  $('gps-label').textContent = locating ? 'Finding location…' : 'Use my location';
  updateMap(selection);
}

function finishGps(request: number) {
  if (request !== locationRequest) return false;
  locating = false;
  renderLocation();

  return true;
}

$('gps').addEventListener('click', () => {
  if (!navigator.geolocation) {
    reportLocationFailure('GPS needs a secure browser connection. Choose your zone manually.');

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
  useLocation({ area, zone }, 'Manual selection');
  zoneDialog.close();
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
  const current = wisconsinDate();

  if (current === today) return;

  if (date === today) date = current;
  today = current;
  renderHours();
}

function offlineStatus(state: 'ready' | 'unavailable', message: string) {
  $('offline-state').dataset.state = state;
  $('offline-state').textContent = message;
}

function isOfflineReady(value: unknown): value is { ready: true } {
  return typeof value === 'object' && value !== null && 'ready' in value && value.ready === true;
}

function checkOffline() {
  if (!import.meta.env.PROD) return;
  const controller = navigator.serviceWorker?.controller;

  if (!controller) return;
  const request = ++offlineRequest;
  const channel = new MessageChannel();

  const timer = setTimeout(() => {
    channel.port1.close();

    if (request === offlineRequest) offlineStatus('unavailable', 'Offline status unavailable');
  }, 4000);

  channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
    clearTimeout(timer);
    channel.port1.close();

    if (request !== offlineRequest) return;

    if (isOfflineReady(data)) offlineStatus('ready', 'Ready offline');
    else offlineStatus('unavailable', 'Offline download incomplete');
  };

  controller.postMessage('offline-status', [channel.port2]);
}

if (!import.meta.env.PROD) {
  offlineStatus('unavailable', 'Offline access requires a production build');
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  checkOffline();
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then(registration => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (!navigator.serviceWorker.controller && installing.state === 'redundant') {
          offlineStatus('unavailable', 'Offline download failed · Reload online');
        }
      });
    })
    .catch(() => {
      if (!navigator.serviceWorker.controller)
        offlineStatus('unavailable', 'Offline download unavailable');
    });
} else {
  offlineStatus('unavailable', 'Offline access unavailable');
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    updateToday();
    checkOffline();
  }
});

setInterval(updateToday, 30_000);

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

$('coverage').textContent = `Table coverage runs from ${firstDay} through ${lastDay}. `;

renderLocation();

renderHours();
