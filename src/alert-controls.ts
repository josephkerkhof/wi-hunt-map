import {
  MINUTE_MS,
  isAlertSchedule,
  nextShootingEvent,
  reminderTimes,
  subscriptionToken,
  type AlertSchedule,
} from './alerts';
import { $ } from './elements';
import { AREAS, type LocationChoice } from './hours';

const storageKey = 'field-hours.alerts';
const api = new URL('api/alerts', document.baseURI);

const eventFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const listFormat = new Intl.ListFormat('en-US');

class AlertRequestError extends Error {}

function savedSchedule(): AlertSchedule | null {
  try {
    const stored = localStorage.getItem(storageKey);
    const value: unknown = stored && JSON.parse(stored);

    return isAlertSchedule(value) && value.event.at > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function waitForBrowser<T>(work: Promise<T>, timeout = 5000) {
  let timer: number | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('Notification request timed out.')), timeout);
  });

  return Promise.race([work, deadline]).finally(() => window.clearTimeout(timer));
}

async function getAlertConfiguration() {
  const response = await fetch(api.href + '/key', { signal: AbortSignal.timeout(8000) });

  if (!response.ok) throw new Error(`Alert configuration returned HTTP ${response.status}.`);
  const data: unknown = await response.json();

  if (!isPublicKeyResponse(data)) throw new Error('Alert configuration has an invalid public key.');

  return Uint8Array.from(
    atob(data.publicKey.replaceAll('-', '+').replaceAll('_', '/') + '='),
    character => character.charCodeAt(0),
  );
}

function isPublicKeyResponse(data: unknown): data is { publicKey: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'publicKey' in data &&
    typeof data.publicKey === 'string' &&
    /^B[A-Za-z0-9_-]{86}$/.test(data.publicKey)
  );
}

function isScheduleResponse(data: unknown): data is { schedule: AlertSchedule | null } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'schedule' in data &&
    (data.schedule === null || isAlertSchedule(data.schedule))
  );
}

function isErrorResponse(data: unknown): data is { message: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string'
  );
}

async function requestSchedule(
  subscription: PushSubscription,
  method: 'GET' | 'PUT' | 'DELETE',
  body?: string,
): Promise<AlertSchedule | null> {
  const auth = subscription.toJSON().keys?.auth;

  if (!auth) throw new Error('This browser’s push subscription could not be used.');
  const token = await subscriptionToken(subscription.endpoint, auth);

  const options: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  };

  if (method === 'PUT') options.body = body;

  const response = await fetch(api, options).catch(() => {
    throw new AlertRequestError('Can’t connect to the alert service. Try again.');
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok || !isScheduleResponse(data)) {
    throw new AlertRequestError(
      isErrorResponse(data) ? data.message : 'Alerts are unavailable right now. Try again.',
    );
  }

  return data.schedule;
}

function supportMessage() {
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || 'standalone' in navigator;

  const standalone =
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if (appleMobile && !standalone) {
    return 'Add Field Hours to your Home Screen and open it there to enable alerts.';
  }

  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) {
    return 'This browser doesn’t support push alerts.';
  }

  return '';
}

function sameKey(key: ArrayBuffer | null, expected: Uint8Array) {
  if (!key || key.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(key);

  return bytes.every((byte, index) => byte === expected[index]);
}

const stoppedMessage =
  'Alerts stopped because this device’s notification subscription changed. Turn them on again.';

function writeText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

export function setupAlertControls(onArmedChange: (armed: boolean) => void) {
  const bell = $('alert-bell', HTMLButtonElement);
  const dialog = $('alert-dialog', HTMLDialogElement);
  const close = $('close-alerts', HTMLButtonElement);
  const summary = $('alert-summary');
  const hint = $('alert-hint');
  const feedback = $('alert-feedback');
  const enable = $('enable-alerts', HTMLButtonElement);
  const disable = $('disable-alerts', HTMLButtonElement);
  const retry = $('retry-alerts', HTMLButtonElement);
  const actions = [enable, disable, retry];
  const unsupported = supportMessage();
  let busy: 'enable' | 'disable' | null = null;
  let refreshing = false;
  let refreshFailed = false;
  let actionVersion = 0;
  let registration: ServiceWorkerRegistration | undefined;
  let publicKey: Uint8Array<ArrayBuffer> | undefined;
  let loadingConfiguration = false;
  let configurationFailed = false;
  let selection: LocationChoice | null = null;
  let schedule: AlertSchedule | null = null;
  let offered: AlertSchedule | null = null;
  let message = '';
  // Set when alerts stop without the user turning them off. Cleared by the next action.
  let notice = '';
  // Whether the server confirmed the schedule since this page loaded.
  let confirmed = false;

  function updateBell() {
    const unconfirmed = schedule !== null && !confirmed && (refreshFailed || !navigator.onLine);
    const label = schedule ? (unconfirmed ? 'Check alerts' : 'Alerts on') : 'Alerts off';
    bell.dataset.active = String(schedule !== null);
    $('alert-icon-off').hidden = schedule !== null;
    $('alert-icon-on').hidden = schedule === null;
    writeText($('alert-bell-label'), label);
  }

  function setSchedule(next: AlertSchedule | null) {
    if (
      schedule?.event.at === next?.event.at &&
      schedule?.area === next?.area &&
      schedule?.zone === next?.zone
    )
      return;
    schedule = next;

    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      // The current schedule is still available from the server.
    }

    updateBell();
    onArmedChange(next !== null);
  }

  function render(now = new Date()) {
    if (schedule && schedule.event.at <= now.getTime()) setSchedule(null);
    updateBell();

    if (!dialog.open) return;
    const active = schedule !== null;
    const location = schedule ?? selection;
    const event = schedule?.event ?? (location && nextShootingEvent(location, now));
    offered = location && event ? { area: location.area, zone: location.zone, event } : null;

    const offline = navigator.onLine ? '' : 'Connect to the internet to manage alerts.';

    const blocked =
      offline ||
      unsupported ||
      (Notification.permission === 'denied'
        ? 'Allow notifications in your device or browser settings.'
        : '') ||
      (!registration?.active || !publicKey ? 'Alerts are unavailable right now.' : '');

    let details = '';

    if (event && location) {
      const prefix = active ? 'Alerts on for' : 'Next';
      details = `${prefix} ${event.kind} · ${eventFormat.format(event.at)} CT · ${AREAS[location.area]} Zone ${location.zone}`;
    } else if (location) details = 'The next shooting time is unavailable.';
    else details = 'Choose a hunt location to set up alerts.';

    summary.dataset.active = String(active);
    writeText(summary, details);
    let guidance = '';

    if (event) {
      const action = event.kind === 'opening' ? 'open' : 'close';
      const offsets = reminderTimes(event, now.getTime()).map(at => (event.at - at) / MINUTE_MS);
      const minutes = listFormat.format(offsets.map(String));
      const unit = offsets.length === 1 && offsets[0] === 1 ? 'minute' : 'minutes';
      guidance = offsets.length
        ? `You’ll get alerts ${minutes} ${unit} before this event and when shooting hours ${action}.`
        : `You’ll get an alert when shooting hours ${action}.`;

      if (active) guidance += ' This set turns off automatically at the scheduled time.';
    }

    writeText(hint, guidance);

    const progress =
      busy === 'enable'
        ? 'Turning alerts on…'
        : busy === 'disable'
          ? 'Turning alerts off…'
          : loadingConfiguration || (refreshing && (!registration?.active || refreshFailed))
            ? 'Checking alerts…'
            : '';

    const retryStatus = refreshFailed && (active || !registration?.active);

    const issue = configurationFailed
      ? 'Can’t connect to the alert service.'
      : message || (retryStatus ? 'Couldn’t confirm alert status.' : '') || (active ? '' : notice);

    writeText(feedback, offline || progress || issue || (active ? '' : blocked));

    const focused = actions.find(action => action === document.activeElement);
    enable.hidden = active || !event || Boolean(unsupported) || configurationFailed;
    enable.setAttribute('aria-disabled', String(Boolean(blocked || busy)));
    disable.hidden = !active;
    disable.setAttribute(
      'aria-disabled',
      String(!navigator.onLine || busy !== null || !registration?.active),
    );
    retry.hidden = !configurationFailed && !retryStatus;
    retry.setAttribute(
      'aria-disabled',
      String(loadingConfiguration || refreshing || Boolean(busy) || !navigator.onLine),
    );

    if (focused?.hidden) (actions.find(action => !action.hidden) ?? close).focus();
  }

  async function loadConfiguration() {
    if (publicKey || loadingConfiguration || !navigator.onLine || unsupported) return;
    loadingConfiguration = true;
    render();

    try {
      publicKey = await getAlertConfiguration();
      configurationFailed = false;
    } catch (error) {
      configurationFailed = true;
      console.warn('Alert service check failed.', error);
    } finally {
      loadingConfiguration = false;
      render();
    }
  }

  async function refresh() {
    if (unsupported || busy || refreshing || !navigator.onLine) return;
    const checkSubscription = Notification.permission === 'granted';

    if (!dialog.open && !checkSubscription) return;
    const version = actionVersion;
    refreshing = true;
    render();

    try {
      if (!registration?.active) {
        registration = await waitForBrowser(navigator.serviceWorker.ready);
        render();
      }

      const subscription = checkSubscription
        ? await waitForBrowser(registration.pushManager.getSubscription())
        : null;

      if (version !== actionVersion) return;

      // A subscription made with a previous server key can no longer receive alerts.
      const usable =
        subscription &&
        (!publicKey || sameKey(subscription.options.applicationServerKey, publicKey));

      const current = usable ? await requestSchedule(subscription, 'GET') : null;

      if (version !== actionVersion) return;
      const expected = schedule;
      refreshFailed = false;
      confirmed = true;

      if (!current && checkSubscription && expected && expected.event.at > Date.now()) {
        notice = stoppedMessage;
      }

      setSchedule(current);
    } catch (error) {
      if (version === actionVersion) refreshFailed = true;
      console.warn('Couldn’t check alert status.', error);
    } finally {
      refreshing = false;
      render();

      if (version !== actionVersion && message && !busy) void refresh();
    }
  }

  bell.addEventListener('click', () => {
    message = '';
    dialog.showModal();
    render();
    void loadConfiguration();
    void refresh();
  });

  retry.addEventListener('click', () => {
    if (retry.getAttribute('aria-disabled') === 'true') return;
    message = '';
    void loadConfiguration();
    void refresh();
  });

  enable.addEventListener('click', async () => {
    if (!publicKey || !registration || !offered || enable.getAttribute('aria-disabled') === 'true')
      return;
    const { area, zone, event } = offered;
    actionVersion++;
    refreshFailed = false;
    busy = 'enable';
    message = '';
    render();

    try {
      const existing = await waitForBrowser(registration.pushManager.getSubscription());

      // Subscribing with a new server key fails while the old subscription exists.
      if (existing && !sameKey(existing.options.applicationServerKey, publicKey)) {
        await requestSchedule(existing, 'DELETE').catch(() => null);
        await waitForBrowser(existing.unsubscribe());
      }

      const subscription = await waitForBrowser(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        }),
        30_000,
      );

      const body = JSON.stringify({
        area,
        zone,
        eventAt: event.at,
        subscription: subscription.toJSON(),
      });

      setSchedule(await requestSchedule(subscription, 'PUT', body));
      confirmed = true;
      notice = '';
    } catch (error) {
      message =
        Notification.permission === 'denied'
          ? 'Allow notifications in your device or browser settings.'
          : error instanceof AlertRequestError
            ? error.message
            : 'Couldn’t turn on alerts. Try again.';
      console.warn('Couldn’t turn on alerts.', error);
    } finally {
      busy = null;
      render();

      if (message) void refresh();
    }
  });

  disable.addEventListener('click', async () => {
    if (!registration || disable.getAttribute('aria-disabled') === 'true') return;
    actionVersion++;
    refreshFailed = false;
    busy = 'disable';
    message = '';
    render();

    try {
      const subscription = await waitForBrowser(registration.pushManager.getSubscription());

      setSchedule(subscription ? await requestSchedule(subscription, 'DELETE') : null);
      confirmed = true;
      notice = '';
    } catch (error) {
      message =
        error instanceof AlertRequestError ? error.message : 'Couldn’t turn off alerts. Try again.';
      console.warn('Couldn’t turn off alerts.', error);
    } finally {
      busy = null;
      render();

      if (message) void refresh();
    }
  });

  window.addEventListener('online', () => {
    message = '';

    if (dialog.open) void loadConfiguration();
    void refresh();
  });
  window.addEventListener('offline', () => render());

  if (!unsupported) {
    if (Notification.permission === 'granted') setSchedule(savedSchedule());
    navigator.serviceWorker.addEventListener('controllerchange', () => void refresh());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        render();
        void refresh();
      }
    });
    window.addEventListener('storage', event => {
      if (event.key !== storageKey) return;
      actionVersion++;
      refreshFailed = false;
      setSchedule(savedSchedule());
      render();
    });
    void refresh();
  }

  return (location: LocationChoice | null, now = new Date()) => {
    selection = location;
    render(now);
  };
}
