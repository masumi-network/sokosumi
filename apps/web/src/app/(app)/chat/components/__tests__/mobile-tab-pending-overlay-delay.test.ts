import { describe, expect, it } from "vitest";

import {
  MOBILE_TAB_PENDING_OVERLAY_DELAY_MS,
  resolveDelayedOverlayVisible,
} from "../mobile-tab-pending-overlay-delay";

describe("resolveDelayedOverlayVisible", () => {
  it("stays hidden while pending under the delay threshold", () => {
    expect(
      resolveDelayedOverlayVisible({
        pending: true,
        pendingForMs: MOBILE_TAB_PENDING_OVERLAY_DELAY_MS - 1,
      }),
    ).toBe(false);
  });

  it("becomes visible at the delay threshold while pending", () => {
    expect(
      resolveDelayedOverlayVisible({
        pending: true,
        pendingForMs: MOBILE_TAB_PENDING_OVERLAY_DELAY_MS,
      }),
    ).toBe(true);
  });

  it("hides immediately when pending clears even after the delay", () => {
    expect(
      resolveDelayedOverlayVisible({
        pending: false,
        pendingForMs: MOBILE_TAB_PENDING_OVERLAY_DELAY_MS + 100,
      }),
    ).toBe(false);
  });
});
