/**
 * The payment node's OWN error message, or null when the payload is not the
 * node's documented `{ error: { message } }` envelope.
 *
 * The null is load-bearing, which is why this is separate from
 * {@link extractNodeErrorMessage}. Two callers need to distinguish "the node
 * answered" from "something answered on the node's behalf":
 *
 *  - the x402 refusal taxonomy, whose "no header was issued" premise is a
 *    claim about the NODE's handler and not about any proxy in front of it;
 *  - the coworker-facing echo of a node 400, which must repeat the node's own
 *    sentence and never the whole-body JSON dump below.
 */
export function readNodeErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "message" in error.error &&
    typeof error.error.message === "string"
  ) {
    return error.error.message;
  }
  return null;
}

/**
 * Cap on the fallback dump below.
 *
 * A body that is not the node's envelope was written by whatever answered on
 * its behalf, and that is routinely a whole HTML page: a Cloudflare 521 in
 * front of a restarting node is ~1.2 kB of doctype, inline CSS, and a Ray ID.
 * The opening characters already identify the far side; the rest is markup
 * that fills a log line and a Sentry title. Only the fallback is capped. The
 * node's OWN message is returned whole because callers echo it.
 */
const MAX_FALLBACK_MESSAGE_LENGTH = 300;

function truncateFallback(dump: string): string {
  if (dump.length <= MAX_FALLBACK_MESSAGE_LENGTH) {
    return dump;
  }
  // The suffix counts against the cap. Slicing to the cap and then appending
  // it returns a longer string than the cap allows.
  const suffix = `... (truncated from ${dump.length} chars)`;
  return `${dump.slice(0, MAX_FALLBACK_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Extracts the payment node's human-readable error message from an error
 * payload of unknown shape (`{ error: { message } }` on the documented
 * responses), falling back to a capped JSON dump of whatever else arrived.
 *
 * The fallback is for LOGS and Sentry. It serializes whatever the far side
 * sent, so it must not be echoed to a caller — use
 * {@link readNodeErrorMessage} where the value is going to be returned.
 */
export function extractNodeErrorMessage(error: unknown): string {
  const message = readNodeErrorMessage(error);
  if (message !== null) {
    return message;
  }
  try {
    return truncateFallback(JSON.stringify(error) ?? String(error));
  } catch {
    return truncateFallback(String(error));
  }
}
