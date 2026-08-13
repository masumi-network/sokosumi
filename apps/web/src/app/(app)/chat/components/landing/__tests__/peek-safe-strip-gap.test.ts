import { describe, expect, it } from "vitest";

import {
  isOverflowStripGapPeekSafe,
  resolveOverflowStripGapPx,
} from "../peek-safe-strip-gap";

/**
 * Invariant: with a middle chip optically centered,
 * `d = Vp/2 - itemW/2`, `rem = d % (itemW+g)`, edge sits in a chip iff `rem >= g`.
 */
function expectPeekSafe(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
): void {
  expect(isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, gapPx)).toBe(
    true,
  );
}

describe("isOverflowStripGapPeekSafe", () => {
  it("is true when rem lands in the chip band", () => {
    // d=151, period=104, rem=47 >= g=16
    expect(isOverflowStripGapPeekSafe(390, 88, 16)).toBe(true);
  });

  it("is false when rem lands in the gap band", () => {
    // d=105, period=100, rem=5 < g=20
    expect(isOverflowStripGapPeekSafe(290, 80, 20)).toBe(false);
  });

  it("is false when rem is 0 (flush chip start, no peek-cut)", () => {
    // d=100, period=100, rem=0
    expect(isOverflowStripGapPeekSafe(280, 80, 20)).toBe(false);
  });
});

describe("resolveOverflowStripGapPx", () => {
  it("returns preferred when it already peek-cuts both edges", () => {
    expect(
      resolveOverflowStripGapPx({
        viewportWidthPx: 390,
        itemWidthPx: 88,
        preferredGapPx: 16,
      }),
    ).toBe(16);
  });

  it("adjusts gap when preferred leaves an empty edge", () => {
    // d=148, preferred period=120 → rem=28 < 40 (gap band).
    const preferredGapPx = 40;
    const viewportWidthPx = 376;
    const itemWidthPx = 80;

    expect(
      isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, preferredGapPx),
    ).toBe(false);

    const gap = resolveOverflowStripGapPx({
      viewportWidthPx,
      itemWidthPx,
      preferredGapPx,
    });

    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(preferredGapPx * 1.5);
    expectPeekSafe(viewportWidthPx, itemWidthPx, gap);

    // Half-chip target: rem ≈ g + itemW/2 (k=1 → g=14)
    const d = viewportWidthPx / 2 - itemWidthPx / 2;
    const rem = d % (itemWidthPx + gap);
    expect(rem).toBeCloseTo(gap + itemWidthPx / 2, 5);
    expect(gap).toBeCloseTo(14, 5);
  });

  it("clamps adjusted gap to at most ~1.5× preferred", () => {
    // Preferred fails (rem in gap). Half-chip k=0 is huge; resolver must
    // stay within 1.5× and still peek-cut.
    const preferredGapPx = 70;
    const viewportWidthPx = 500;
    const itemWidthPx = 88;

    expect(
      isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, preferredGapPx),
    ).toBe(false);

    const gap = resolveOverflowStripGapPx({
      viewportWidthPx,
      itemWidthPx,
      preferredGapPx,
    });

    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(preferredGapPx * 1.5 + 1e-9);
    expectPeekSafe(viewportWidthPx, itemWidthPx, gap);
  });

  it("keeps gap positive for typical mobile compact strip numbers", () => {
    const gap = resolveOverflowStripGapPx({
      viewportWidthPx: 375,
      itemWidthPx: 88,
      preferredGapPx: 16,
    });

    expect(gap).toBeGreaterThan(0);
    expectPeekSafe(375, 88, gap);
  });
});
