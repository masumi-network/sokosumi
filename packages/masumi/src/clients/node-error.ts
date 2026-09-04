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
 * Stand-in for a dump that carries no information at all.
 *
 * Two different far sides produce the same empty object. hey-api's catch ends
 * in `finalError = finalError || {}`, so a non-ok response with an EMPTY body
 * arrives as `{}`; and a node that answers with a literal `{}` body is
 * byte-for-byte indistinguishable from it. Neither says anything, and `"{}"`
 * as a Sentry title reads as a bug in this dump rather than as silence from
 * the far side. The status the caller prints alongside is then the only real
 * signal, which is what this says out loud.
 */
const NO_ERROR_DETAIL = "(no error detail)";

/**
 * Extracts the payment node's human-readable error message from an error
 * payload of unknown shape (`{ error: { message } }` on the documented
 * responses), falling back to a capped dump of whatever else arrived.
 *
 * The fallback is for LOGS and Sentry. It serializes whatever the far side
 * sent, so it must not be echoed to a caller — use
 * {@link readNodeErrorMessage} where the value is going to be returned.
 *
 * Fetch / AbortSignal failures are `Error` instances (TimeoutError,
 * AbortError). `Error.name` and `Error.message` are non-enumerable, so
 * `JSON.stringify` is `"{}"` — that is the SOKOSUMI-CORE-2Z title
 * `rail-readiness unknown: {}`. Those must use `String(error)`.
 */
export function extractNodeErrorMessage(error: unknown): string {
  const message = readNodeErrorMessage(error);
  if (message !== null) {
    return message;
  }
  if (error instanceof Error) {
    // `String(error)` is the name and message only. undici reports EVERY
    // connection failure as the same `TypeError: fetch failed` and puts the
    // reason (ECONNREFUSED, ENOTFOUND, a TLS failure) in `cause`, so dropping
    // the cause names the layer that failed but never why. One level is
    // enough: that is where undici puts the syscall error.
    return truncateFallback(
      error.cause === undefined ? String(error) : `${error}: ${error.cause}`,
    );
  }
  try {
    const dump = JSON.stringify(error) ?? String(error);
    return truncateFallback(dump === "{}" ? NO_ERROR_DETAIL : dump);
  } catch {
    return truncateFallback(String(error));
  }
}
