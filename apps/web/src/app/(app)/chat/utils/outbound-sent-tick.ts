import { OUTBOUND_SENT_TICK_MS } from "./outbound-room-message";

/**
 * Synchronous sent-tick registry. Marked *before* / *inside* the message
 * list update so the first settled paint after pending can show the check
 * even if React has not yet committed a separate tick useState (Ably-first
 * and post-await confirm paths). Keys: server message id and/or client turn id.
 */
const activeUntilByKey = new Map<string, number>();

function sweepExpiredOutboundSentTicks(nowMs: number): void {
  for (const [key, activeUntil] of activeUntilByKey) {
    if (activeUntil <= nowMs) {
      activeUntilByKey.delete(key);
    }
  }
}

export function markOutboundSentTick(
  keys: string | readonly (string | null | undefined)[],
  durationMs: number = OUTBOUND_SENT_TICK_MS,
): void {
  const nowMs = Date.now();
  // Writes are rare (one per confirmed send). Sweep so keys never read
  // again (leave room / close tab after confirm) cannot grow the Map.
  sweepExpiredOutboundSentTicks(nowMs);
  const until = nowMs + durationMs;
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
  let active = false;
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    const until = activeUntilByKey.get(key) ?? 0;
    if (until <= now) {
      if (until > 0) {
        activeUntilByKey.delete(key);
      }
      continue;
    }
    active = true;
  }
  return active;
}

/** Test helper — clears all ticks. */
export function clearOutboundSentTicksForTests(): void {
  activeUntilByKey.clear();
}
