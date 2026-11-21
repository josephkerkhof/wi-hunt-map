import type { RequestDetails } from 'web-push';
import { pushOutcome, type PushOutcome } from './alert-queue';

/** Workers fetch rejects redirect 'error', so a redirect returns as a response and counts as rejected. */
export function pushRequest(details: RequestDetails) {
  return new Request(details.endpoint, {
    method: details.method,
    headers: new Headers(details.headers),
    body: details.body ? new Uint8Array(details.body) : null,
    redirect: 'manual',
  });
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
    await response.body?.cancel();
    const outcome = pushOutcome(response.status);

    if (outcome !== 'delivered') console.warn('Push service status.', response.status);

    return outcome;
  } catch (error) {
    // A retry reuses the notification tag and topic, so a duplicate replaces the first.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn('Push request failed.', reason);

    return 'retry';
  }
}
