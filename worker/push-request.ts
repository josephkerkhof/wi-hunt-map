import { createHash } from 'node:crypto';
import { generateRequestDetails, type PushSubscription, type RequestDetails } from 'web-push';
import { pushOutcome, type PushOutcome } from './alert-queue';

export interface VapidEnv {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

/** The notification the service worker shows. */
export interface PushMessage {
  title: string;
  body: string;
  tag: string;
}

const pushTimeoutMs = 10_000;

/** Apple refuses a Topic that does not decode as base64url. 32 characters decode to 24 bytes. */
export function pushTopic(tag: string) {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

/** Workers fetch rejects redirect 'error', so a redirect returns as a response and counts as rejected. */
export function pushRequest(details: RequestDetails) {
  return new Request(details.endpoint, {
    method: details.method,
    headers: new Headers(details.headers),
    body: details.body ? new Uint8Array(details.body) : null,
    redirect: 'manual',
  });
}

function isRefusal(value: unknown): value is { reason: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reason' in value &&
    typeof value.reason === 'string'
  );
}

/** Push services explain a refusal in a JSON `reason` field. Apple uses names such as BadJwtToken. */
async function refusalReason(response: Response) {
  const text = await response.text().catch(() => '');

  try {
    const data: unknown = JSON.parse(text);

    if (isRefusal(data)) return data.reason;
  } catch {
    // The body is not JSON. Log the start of the text.
  }

  return text.slice(0, 200);
}

/** Only a send error is retried. A request that cannot be built is a code or configuration error. */
export async function sendPush(
  build: () => Request,
  send: (request: Request) => Promise<Response>,
): Promise<PushOutcome> {
  let request: Request;

  try {
    request = build();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error('Push request could not be built.', reason);

    return 'failed';
  }

  try {
    const response = await send(request);
    const outcome = pushOutcome(response.status);

    if (outcome === 'delivered') await response.body?.cancel();
    else console.warn('Push service status.', response.status, await refusalReason(response));

    return outcome;
  } catch (error) {
    // A retry reuses the notification tag and topic, so a duplicate replaces the first.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn('Push request failed.', reason);

    return 'retry';
  }
}

/** Encrypts, signs, and sends one message. `ttl` is in seconds. */
export function deliverPush(
  env: VapidEnv,
  subscription: PushSubscription,
  message: PushMessage,
  ttl: number,
) {
  return sendPush(
    () =>
      pushRequest(
        generateRequestDetails(subscription, JSON.stringify(message), {
          TTL: ttl,
          contentEncoding: 'aes128gcm',
          topic: pushTopic(message.tag),
          urgency: 'high',
          vapidDetails: {
            subject: env.VAPID_SUBJECT,
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
          },
        }),
      ),
    request => fetch(request, { signal: AbortSignal.timeout(pushTimeoutMs) }),
  );
}
