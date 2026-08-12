import { OUTBOUND_SENT_TICK_MS } from "./outbound-room-message";

/**
 * Synchronous sent-tick registry. Marked *before* / *inside* the message
 * list update so the first settled paint after pending can show the check
 * even if React has not yet committed a separate tick useState (Ably-first
 * and post-await confirm paths). Keys: server message id and/or client turn id.
 */
const activeUntilByKey = new Map<string, number>();

export function markOutboundSentTick(
  keys: string | readonly (string | null | undefined)[],
  durationMs: number = OUTBOUND_SENT_TICK_MS,
): void {
  const until = Date.now() + durationMs;
  const list = typeof keys === "string" ? [keys] : keys;
  for (const key of list) {
    if (typeof key === "string" && key.length > 0) {
      activeUntilByKey.set(key, until);
    }
  }
}

export function isOutboundSentTickActive(
  ...keys: (string | null | undefined)[]
): boolean {
  const now = Date.now();
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    if ((activeUntilByKey.get(key) ?? 0) > now) {
      return true;
    }
  }
  return false;
}

/** Test helper — clears all ticks. */
export function clearOutboundSentTicksForTests(): void {
  activeUntilByKey.clear();
}
