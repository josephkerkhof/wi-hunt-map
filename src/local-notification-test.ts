function isTestEnabled(value: unknown): value is { localTest: true } {
  return (
    typeof value === 'object' && value !== null && 'localTest' in value && value.localTest === true
  );
}

interface TestNotification {
  id: string;
  message: string;
  title?: string;
}

function isTestNotification(value: unknown): value is TestNotification {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('title' in value) || typeof value.title === 'string')
  );
}

async function showTestNotification({ id, message, title = 'Field Hours test' }: TestNotification) {
  if (Notification.permission !== 'granted') return 'permission';
  const registration = await navigator.serviceWorker.ready;

  await registration.showNotification(title, {
    body: message,
    icon: new URL('assets/icon-192.png', registration.scope).href,
    tag: `field-hours-test-${id}`,
  });

  return 'shown';
}

function displayTestNotification(notification: TestNotification) {
  let timer: number | undefined;

  const deadline = new Promise<'display-timeout'>(resolve => {
    timer = window.setTimeout(() => resolve('display-timeout'), 5000);
  });

  return Promise.race([showTestNotification(notification).catch(() => 'failed'), deadline]).finally(
    () => window.clearTimeout(timer),
  );
}

export function setupLocalNotificationTest() {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;

  if (!('serviceWorker' in navigator && 'Notification' in window)) return;
  const configUrl = new URL('api/alerts/key', document.baseURI);
  const testUrl = new URL('api/alerts/test', document.baseURI);
  const device = crypto.randomUUID();
  let enabled: boolean | undefined;
  let polling = false;
  let timer: number | undefined;

  function contactWorker(reply = '') {
    return fetch(testUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, origin: location.origin, reply, eventAlerts: true }),
      keepalive: reply !== '',
      signal: AbortSignal.timeout(5000),
    });
  }

  async function poll() {
    if (polling || enabled === false || document.hidden || !navigator.onLine) return;
    window.clearTimeout(timer);
    polling = true;

    try {
      if (enabled === undefined) {
        const response = await fetch(configUrl, { signal: AbortSignal.timeout(5000) });

        if (!response.ok) return;
        const config: unknown = await response.json();
        enabled = isTestEnabled(config);
      }

      if (!enabled) return;

      const response = await contactWorker();

      if (response.status === 404) enabled = false;

      if (!response.ok) return;
      const notification: unknown = await response.json();

      if (!isTestNotification(notification)) return;
      const { id } = notification;
      const receipt = await contactWorker(`${id}:received`);

      if (!receipt.ok) return;
      const result = await displayTestNotification(notification);
      await contactWorker(`${id}:${result}`);
    } catch {
      // The local Worker can restart while the app is open.
    } finally {
      polling = false;

      if (enabled !== false && !document.hidden) timer = window.setTimeout(() => void poll(), 1000);
    }
  }

  window.addEventListener('online', () => void poll());
  document.addEventListener('visibilitychange', () => void poll());
  void poll();
}
