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
 * Extracts the payment node's human-readable error message from an error
 * payload of unknown shape (`{ error: { message } }` on the documented
 * responses), falling back to a JSON dump so no detail is dropped.
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
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
