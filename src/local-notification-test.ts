function isTestEnabled(value: unknown): value is { localTest: true } {
  return (
    typeof value === 'object' && value !== null && 'localTest' in value && value.localTest === true
  );
}

function isTestNotification(value: unknown): value is { id: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

async function showTestNotification(id: string, message: string) {
  if (Notification.permission !== 'granted') return 'permission';
  const registration = await navigator.serviceWorker.ready;

  await registration.showNotification('Field Hours test', {
    body: message,
    icon: new URL('assets/icon-192.png', registration.scope).href,
    tag: `field-hours-test-${id}`,
  });

  return 'shown';
}

function displayTestNotification(id: string, message: string) {
  let timer: number | undefined;

  const deadline = new Promise<'display-timeout'>(resolve => {
    timer = window.setTimeout(() => resolve('display-timeout'), 5000);
  });

  return Promise.race([showTestNotification(id, message).catch(() => 'failed'), deadline]).finally(
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
      body: JSON.stringify({ device, origin: location.origin, reply }),
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
      const { id, message } = notification;
      const receipt = await contactWorker(`${id}:received`);

      if (!receipt.ok) return;
      const result = await displayTestNotification(id, message);
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
