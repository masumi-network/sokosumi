/**
 * Shared throttle clock for chat background reads (SOK-1065).
 *
 * Core throttles sustained chat history polling per user with one token
 * bucket across rooms and credentials (SOK-1060), answering 429 with a
 * `Retry-After` header mirroring the body's `retryAfterSeconds`. Per-reader
 * backoff would keep sibling readers burning that shared budget, so every
 * chat background reader — the open room and thread reads, the sidebar
 * active / archived / invitations collections, the unread indicator —
 * consults this one module-level "throttled until" timestamp.
 *
 * `fetch-background-json.ts` arms the clock on a throttled response;
 * `use-chat-refresh-scheduler.ts` consults it before any read starts.
 * Realtime event application is independent of HTTP reads and stays live.
 */

/**
 * Bounded wait when a 429 carries no usable delay (SOK-1065). Core always
 * sends a real delay; this covers a throttle that lost its envelope on the
 * way (a proxy bug, an intermediary). Seconds, never minutes: long enough
 * to matter, short enough that resuming early self-corrects — the next
 * read is throttled again and re-arms with the real delay.
 */
export const CHAT_READ_THROTTLE_FALLBACK_SECONDS = 5;

/**
 * Spread of the one-sided jitter added to the resume wait, as a fraction
 * of the remaining window. Co-throttled readers must not resume in
 * lockstep and stampede Core the instant the window ends; the jitter only
 * ever delays past the asked-for delay, never shortens it. Same fraction
 * as the stall-retry spread in `fetch-background-json.ts`.
 */
const THROTTLE_RESUME_JITTER_FRACTION = 0.25;

/** Milliseconds since the epoch until which chat background reads stay quiet. */
let throttledUntilMs = 0;

/**
 * Reads a retry delay in whole seconds from a `Retry-After` header value
 * or an error body field. Anything missing, unparseable, or non-positive
 * is no usable delay — the caller falls back to the bounded wait instead
 * of treating it as no throttle. A huge delay is honored as asked: capping
 * it would only manufacture another 429, which re-arms anyway.
 */
export function parseRetryDelaySeconds(value: unknown): number | undefined {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return undefined;
  }
  const wholeSeconds = Math.ceil(seconds);
  return wholeSeconds >= 1 ? wholeSeconds : undefined;
}

/**
 * Notes that a chat background read was throttled. The clock moves to the
 * later of its current value and the newly asked-for deadline, so a second
 * throttle inside the window extends the quiet period instead of letting
 * the client creep forward. Any unusable delay — missing, non-finite, or
 * below one second — arms the bounded fallback wait instead: NaN or
 * Infinity would poison the clock through `Math.max`, and zero or
 * negative would silently un-throttle a signaled throttle.
 */
export function noteChatReadThrottled(delaySeconds?: number): void {
  const validDelay =
    delaySeconds !== undefined &&
    Number.isFinite(delaySeconds) &&
    delaySeconds >= 1
      ? delaySeconds
      : CHAT_READ_THROTTLE_FALLBACK_SECONDS;
  const waitMs = validDelay * 1000;
  throttledUntilMs = Math.max(throttledUntilMs, Date.now() + waitMs);
}

/**
 * How long the calling reader must stay quiet: 0 when the clock is clear,
 * otherwise the remaining window plus resume jitter. Consult before every
 * chat background read starts.
 */
export function chatReadThrottleResumeInMs(): number {
  const remainingMs = throttledUntilMs - Date.now();
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.round(
    remainingMs + Math.random() * remainingMs * THROTTLE_RESUME_JITTER_FRACTION,
  );
}

/** Test helper — clears the shared clock. */
export function resetChatReadThrottleForTests(): void {
  throttledUntilMs = 0;
}
