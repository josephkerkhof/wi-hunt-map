import { AREAS, FIRST_DATE, LAST_DATE, OFFSETS, clockParts, dailyHours, locate, wisconsinDate } from './hours.js';
import { setupZoneMap } from './zone-map.js';

const $ = id => document.getElementById(id);
const storageKey = 'field-hours.location';
const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
});
const coverageFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});
const mapHint = 'Tap the map to select a location.';
const boundaryMessages = {
  accuracy: 'Location accuracy is too low. Try GPS again or choose your zone.',
  boundary: 'This point is near a boundary. Confirm your area and zone on the DNR map.',
  outside: 'This point couldn’t be placed inside Wisconsin. Try another location or choose your zone.',
};

let selection = loadLocation();
let today = wisconsinDate();
let date = today;
let locating = false;
let locationRequest = 0;
let installPrompt;
let offlineRequest = 0;

function loadLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Object.hasOwn(AREAS, saved.area) && Object.hasOwn(OFFSETS, saved.zone)) {
      return { ...saved, source: 'Saved location' };
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return null;
}

function useLocation(choice, source, point) {
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

function locationMessage(message) {
  $('location-message').hidden = !message;
  $('location-message').textContent = message;
}

function reportLocationFailure(message) {
  const previous = selection ? ' The window still uses the location shown above.' : '';
  locationMessage(message + previous);
}

function shiftDate(days) {
  if (date > LAST_DATE && days < 0) return setDate(LAST_DATE);
  if (date < FIRST_DATE && days > 0) return setDate(FIRST_DATE);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  setDate(day.toISOString().slice(0, 10));
}

function setDate(value) {
  date = value;
  renderHours();
}

function writeTime(id, value) {
  const parts = value === undefined ? { time: '—', period: '' } : clockParts(value);
  $(id).textContent = parts.time;
  $(`${id}-period`).textContent = parts.period;
}

function renderHours() {
  const selected = $('selected-date');
  selected.dateTime = date;
  selected.textContent = dateFormat.format(new Date(`${date}T00:00:00Z`));
  $('date').value = date;
  $('previous').disabled = date <= FIRST_DATE;
  $('next').disabled = date >= LAST_DATE;
  $('today').disabled = date === today;

  const hours = dailyHours(date, selection);
  writeTime('opening', hours?.opens);
  writeTime('closing', hours?.closes);
  let context = 'Choose your location to see hours.';
  if (date < FIRST_DATE || date > LAST_DATE) {
    context = 'No DNR table is bundled for this date.';
  } else if (hours) {
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
  $('gps').disabled = locating;
  $('gps-label').textContent = locating ? 'Finding location…' : 'Use my location';
  updateMap(selection);
}

function finishGps(request) {
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
  navigator.geolocation.getCurrentPosition(position => {
    if (!finishGps(request)) return;
    const { longitude, latitude, accuracy } = position.coords;
    const choice = locate(longitude, latitude, accuracy);
    if (choice.error) reportLocationFailure(boundaryMessages[choice.error]);
    else useLocation(choice, 'GPS', [longitude, latitude]);
  }, error => {
    if (!finishGps(request)) return;
    const message = error.code === 1
      ? 'Location access is off. Allow it in browser settings or choose your zone.'
      : 'GPS couldn’t get a fix. Try again or choose your zone.';
    reportLocationFailure(message);
  }, { enableHighAccuracy: true, timeout: 16_000, maximumAge: 0 });
});

const updateMap = setupZoneMap($('zone-map'), (point, accuracy) => {
  const choice = locate(...point, accuracy);
  if (choice.error) {
    $('map-guide').textContent = boundaryMessages[choice.error];
    return;
  }
  locationRequest += 1;
  locating = false;
  useLocation(choice, 'Map selection', point);
});

$('manual').addEventListener('click', () => {
  $('area').value = selection?.area ?? '';
  $('zone').value = selection?.zone ?? '';
  $('zone-dialog').showModal();
});
$('zone-form').addEventListener('submit', event => {
  event.preventDefault();
  const area = $('area').value;
  const zone = $('zone').value;
  if (!Object.hasOwn(AREAS, area) || !Object.hasOwn(OFFSETS, zone)) return;
  locationRequest += 1;
  locating = false;
  useLocation({ area, zone }, 'Manual selection');
  $('zone-dialog').close();
});
document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => $(button.dataset.close).close());
});

$('previous').addEventListener('click', () => shiftDate(-1));
$('next').addEventListener('click', () => shiftDate(1));
$('today').addEventListener('click', () => {
  today = wisconsinDate();
  setDate(today);
});
$('date').addEventListener('change', event => {
  const { value } = event.target;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value);
  else event.target.value = date;
});

function updateToday() {
  const current = wisconsinDate();
  if (current === today) return;
  if (date === today) date = current;
  today = current;
  renderHours();
}

function offlineStatus(state, message) {
  $('offline-state').dataset.state = state;
  $('offline-state').textContent = message;
}

function checkOffline() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  const request = ++offlineRequest;
  const channel = new MessageChannel();
  const timer = setTimeout(() => {
    channel.port1.close();
    if (request === offlineRequest) offlineStatus('unavailable', 'Offline status unavailable');
  }, 4000);
  channel.port1.onmessage = ({ data }) => {
    clearTimeout(timer);
    channel.port1.close();
    if (request !== offlineRequest) return;
    if (data.ready) offlineStatus('ready', 'Ready offline');
    else offlineStatus('unavailable', 'Offline download incomplete');
  };
  controller.postMessage('offline-status', [channel.port2]);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  checkOffline();
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
    registration.installing?.addEventListener('statechange', event => {
      if (!navigator.serviceWorker.controller && event.target.state === 'redundant') {
        offlineStatus('unavailable', 'Offline download failed · Reload online');
      }
    });
  }).catch(() => {
    if (!navigator.serviceWorker.controller) offlineStatus('unavailable', 'Offline download unavailable');
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
window.addEventListener('appinstalled', () => { $('install').hidden = true; });
$('install').hidden = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('install').addEventListener('click', async () => {
  if (!installPrompt) {
    $('install-dialog').showModal();
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
  } catch {
    $('install-dialog').showModal();
  }
});

$('date').min = FIRST_DATE;
$('date').max = LAST_DATE;
const [firstDay, lastDay] = [FIRST_DATE, LAST_DATE].map(value => coverageFormat.format(new Date(`${value}T00:00:00Z`)));
$('coverage').textContent = `Table coverage runs from ${firstDay} through ${lastDay}. `;
renderLocation();
renderHours();
