import type { Viewport } from "next";

/**
 * Shared base for root + chat Next.js `viewport` exports.
 *
 * `maximumScale: 1` locks page scale so iOS Safari does not auto-zoom on
 * input/composer focus. Pinch-to-zoom is disabled (product decision).
 * Chat spreads this and adds `interactiveWidget: "resizes-content"`.
 */
export const APP_VIEWPORT_BASE = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
} as const satisfies Viewport;
