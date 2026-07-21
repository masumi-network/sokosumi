export const POLL_INTERVAL_MS = 5_000;
/** Minimum time a reasoning beat stays on screen before the next phase can
 * replace/clear it — so beats don't flash by unreadably. */
export const REASONING_MIN_MS = 1_000;

/**
 * Within this distance of the bottom, streaming text growth and content
 * resizes (reasoning / tool chips) still pin the viewport. Wider than the
 * jump-to-latest threshold so a small upward nudge mid-stream is not treated
 * as "leave me alone".
 */
export const NEAR_BOTTOM_PX = 200;

/**
 * Tighter distance for showing the "jump to latest" control — appears soon
 * after the user scrolls up, before they leave the stick-to-bottom zone.
 */
export const JUMP_TO_LATEST_PX = 80;

/**
 * Opt-in flag for Hermes streaming + live progress. Off by default so the chat
 * keeps using the buffered /chat path until the orchestrator side is verified
 * (it must support `stream: true` + emit `event: hermes.status` frames). Flip
 * `NEXT_PUBLIC_HERMES_STREAMING=1` to enable end-to-end streaming.
 */
export const HERMES_STREAMING_ENABLED =
  process.env.NEXT_PUBLIC_HERMES_STREAMING === "1";
