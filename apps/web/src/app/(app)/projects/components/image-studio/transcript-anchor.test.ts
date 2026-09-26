import { describe, expect, it } from "vitest";

import { heldScrollTop, isScrolledUp } from "./transcript-anchor";

/**
 * The rule: a message arriving while someone is reading back through the
 * conversation must not move the words they are reading.
 */

describe("isScrolledUp", () => {
  it("does not treat the bottom, or a nudge off it, as reading back", () => {
    expect(isScrolledUp(0)).toBe(false);
    // Overscroll and rubber-banding are not a decision to stop following.
    expect(isScrolledUp(-12)).toBe(false);
  });

  it("treats a real scroll back as reading back", () => {
    expect(isScrolledUp(-600)).toBe(true);
  });
});

describe("heldScrollTop", () => {
  it("moves by exactly the growth, so the same pixel stays on screen", () => {
    // The column is pinned to the bottom of the scroller, so 240px of new
    // reply pushes everything above it 240px up. Going 240px further from
    // the bottom puts it back.
    expect(
      heldScrollTop({
        scrollTop: -1800,
        previousHeight: 4000,
        nextHeight: 4240,
      }),
    ).toBe(-2040);
  });

  it("follows the conversation when the reader is at the bottom", () => {
    expect(
      heldScrollTop({ scrollTop: 0, previousHeight: 4000, nextHeight: 4240 }),
    ).toBeNull();
  });

  it("writes nothing when the height did not grow", () => {
    // Every write is one the browser may be mid-touch-scroll for, so the
    // cheapest way not to fight one is not to make it.
    expect(
      heldScrollTop({
        scrollTop: -1800,
        previousHeight: 4000,
        nextHeight: 4000,
      }),
    ).toBeNull();
    expect(
      heldScrollTop({
        scrollTop: -1800,
        previousHeight: 4000,
        nextHeight: 3800,
      }),
    ).toBeNull();
  });

  it("does nothing on the first measurement", () => {
    expect(
      heldScrollTop({ scrollTop: -1800, previousHeight: 0, nextHeight: 4000 }),
    ).toBeNull();
  });
});
