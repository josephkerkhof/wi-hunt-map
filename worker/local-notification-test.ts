const replies = ['shown', 'permission', 'failed', 'display-timeout'] as const;

type TestReply = (typeof replies)[number] | 'unreachable' | 'unconfirmed';

interface PendingTest {
  notification: { id: string; message: string };
  complete: (reply: TestReply) => void;
  sent: boolean;
  received: boolean;
}

interface TestDevice {
  label: string;
  lastSeen: number;
  pending?: PendingTest;
}

const replyMessages = {
  shown: 'The device accepted the test notification.',
  permission: 'Allow notifications in Field Hours on that device, then try again.',
  failed: 'The device could not show the test notification.',
  'display-timeout':
    'The device took too long to show the test notification. Reopen Field Hours and try again.',
  unreachable: 'The app did not receive the test. Keep Field Hours open and try again.',
  unconfirmed:
    'The app received the test. Check the device’s Notification Center before trying again.',
} satisfies Record<TestReply, string>;

function isTestRequest(value: unknown): value is { device: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'device' in value &&
    typeof value.device === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0 &&
    value.message.length <= 200
  );
}

function isPoll(value: unknown): value is { device: string; origin: string; reply: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'device' in value &&
    typeof value.device === 'string' &&
    /^[a-f0-9-]{36}$/.test(value.device) &&
    'origin' in value &&
    typeof value.origin === 'string' &&
    'reply' in value &&
    typeof value.reply === 'string' &&
    value.reply.length <= 64
  );
}

function json<T>(data: T, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export class LocalNotificationTest {
  private devices = new Map<string, TestDevice>();

  async fetch(request: Request, token: string) {
    const now = Date.now();

    for (const [id, device] of this.devices) {
      if (!device.pending && now - device.lastSeen > 10_000) this.devices.delete(id);
    }

    if (request.method === 'PUT') return this.poll(request, now);

    if (request.headers.get('Authorization') !== `Bearer ${token}`) {
      return json({ message: 'The local test command is unauthorized.' }, 401);
    }

    if (request.method === 'GET') {
      return json(Array.from(this.devices, ([id, { label }]) => ({ id, label })));
    }

    if (request.method !== 'POST') return json({}, 405);
    const data: unknown = await request.json().catch(() => null);

    if (!isTestRequest(data))
      return json({ message: 'Enter a message of 1 to 200 characters.' }, 400);
    const device = this.devices.get(data.device);

    if (!device) return json({ message: 'Open the selected app and try again.' }, 404);

    if (device.pending)
      return json({ message: 'A test is already in progress for this app.' }, 409);
    const id = crypto.randomUUID();

    const reply = await new Promise<TestReply>(resolve => {
      const timer = setTimeout(
        () => finish(device.pending?.received ? 'unconfirmed' : 'unreachable'),
        12_000,
      );

      function finish(outcome: TestReply) {
        clearTimeout(timer);
        resolve(outcome);
      }

      device.pending = {
        notification: { id, message: data.message.trim() },
        complete: finish,
        sent: false,
        received: false,
      };
    });

    device.pending = undefined;

    return json({ message: replyMessages[reply] }, reply === 'shown' ? 200 : 422);
  }

  private async poll(request: Request, now: number) {
    if (request.headers.get('Content-Type') !== 'application/json') return json({}, 415);
    const data: unknown = await request.json().catch(() => null);

    if (!isPoll(data)) return json({}, 400);
    const origin = URL.parse(data.origin);

    if (
      !origin ||
      !['http:', 'https:'].includes(origin.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    )
      return json({}, 403);

    const agent = request.headers.get('User-Agent') ?? '';
    const label = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : 'Browser';

    const device = this.devices.get(data.device) ?? {
      label: `${label} · ${origin.host}`,
      lastSeen: now,
    };

    device.lastSeen = now;
    this.devices.set(data.device, device);
    const test = device.pending;

    if (data.reply) {
      if (!test) return json({}, 410);
      const prefix = `${test.notification.id}:`;

      if (!data.reply.startsWith(prefix)) return json({}, 410);
      const answer = data.reply.slice(prefix.length);
      const reply = replies.find(candidate => candidate === answer);

      if (answer === 'received') test.received = true;
      else if (reply) test.complete(reply);
      else return json({}, 400);

      return json(null, 202);
    }

    if (!test || test.sent) return json(null);
    test.sent = true;

    return json(test.notification);
  }
}
