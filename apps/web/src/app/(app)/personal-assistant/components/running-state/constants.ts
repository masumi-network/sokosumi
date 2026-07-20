export const POLL_INTERVAL_MS = 5_000;
/** Minimum time a reasoning beat stays on screen before the next phase can
 * replace/clear it — so beats don't flash by unreadably. */
export const REASONING_MIN_MS = 1_000;

/**
 * Opt-in flag for Hermes streaming + live progress. Off by default so the chat
 * keeps using the buffered /chat path until the orchestrator side is verified
 * (it must support `stream: true` + emit `event: hermes.status` frames). Flip
 * `NEXT_PUBLIC_HERMES_STREAMING=1` to enable end-to-end streaming.
 */
export const HERMES_STREAMING_ENABLED =
  process.env.NEXT_PUBLIC_HERMES_STREAMING === "1";
