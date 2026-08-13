import { describe, expect, it } from "vitest";

import {
  isOverflowStripGapPeekSafe,
  overflowStripEdgePeekPx,
  resolveOverflowStripGapPx,
  STRIP_MIN_CLIP_FRACTION,
  STRIP_MIN_VISIBLE_PEEK_FRACTION,
  STRIP_TARGET_PEEK_FRACTION,
} from "../peek-safe-strip-gap";

function expectStrongPeek(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
): void {
  expect(isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, gapPx)).toBe(
    true,
  );

  const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gapPx);
  expect(peekPx).not.toBeNull();
  expect(peekPx!).toBeGreaterThanOrEqual(
    itemWidthPx * STRIP_MIN_VISIBLE_PEEK_FRACTION,
  );
  expect(itemWidthPx - peekPx!).toBeGreaterThanOrEqual(
    itemWidthPx * STRIP_MIN_CLIP_FRACTION,
  );
}

describe("overflowStripEdgePeekPx", () => {
  it("returns null when the edge lands in the gap band", () => {
    expect(overflowStripEdgePeekPx(290, 80, 20)).toBeNull();
  });

  it("returns visible chip depth when the edge cuts a chip", () => {
    expect(overflowStripEdgePeekPx(390, 88, 16)).toBeCloseTo(31, 5);
  });
});

describe("isOverflowStripGapPeekSafe", () => {
  it("is false when rem lands in the gap band", () => {
    expect(isOverflowStripGapPeekSafe(290, 80, 20)).toBe(false);
  });

  it("is false for a tiny visible sliver", () => {
    expect(overflowStripEdgePeekPx(328, 80, 20)).toBeCloseTo(4, 5);
    expect(isOverflowStripGapPeekSafe(328, 80, 20)).toBe(false);
  });

  it("is false for a near-full chip with only a haircut (desktop failure mode)", () => {
    expect(overflowStripEdgePeekPx(896, 112, 20)).toBeCloseTo(108, 5);
    expect(isOverflowStripGapPeekSafe(896, 112, 20)).toBe(false);
  });

  it("is true near the mobile QA ballpark (~65% visible)", () => {
    // Construct peek ≈ 0.65 * 88 ≈ 57.2
    const itemWidthPx = 88;
    const gapPx = 16;
    const peekPx = itemWidthPx * STRIP_TARGET_PEEK_FRACTION;
    const d = gapPx + peekPx; // k=0
    const viewportWidthPx = 2 * d + itemWidthPx;
    expect(
      overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gapPx),
    ).toBeCloseTo(peekPx, 5);
    expect(
      isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, gapPx),
    ).toBe(true);
  });
});

describe("resolveOverflowStripGapPx", () => {
  it("adjusts gap when preferred leaves an empty edge", () => {
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
    expect(gap).toBeLessThanOrEqual(preferredGapPx * 2.5);
    expectStrongPeek(viewportWidthPx, itemWidthPx, gap);
  });

  it("strengthens desktop max-w-4xl peek to ~mobile ballpark, not a 4px haircut", () => {
    const viewportWidthPx = 896;
    const itemWidthPx = 112;
    const preferredGapPx = 20;

    expect(
      isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, preferredGapPx),
    ).toBe(false);

    const gap = resolveOverflowStripGapPx({
      viewportWidthPx,
      itemWidthPx,
      preferredGapPx,
    });

    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(preferredGapPx * 2.5 + 1e-9);
    expectStrongPeek(viewportWidthPx, itemWidthPx, gap);

    const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gap)!;
    // Same ballpark as mobile QA (~72px / ~65% of chip), not 4px.
    expect(peekPx).toBeGreaterThanOrEqual(itemWidthPx * 0.55);
    expect(peekPx).toBeLessThanOrEqual(itemWidthPx * 0.75);
  });

  it("keeps mobile 375 compact peek strong (at least 40% of a chip)", () => {
    const gap = resolveOverflowStripGapPx({
      viewportWidthPx: 375,
      itemWidthPx: 88,
      preferredGapPx: 16,
    });

    expect(gap).toBeGreaterThan(0);
    expectStrongPeek(375, 88, gap);

    const peekPx = overflowStripEdgePeekPx(375, 88, gap)!;
    expect(peekPx).toBeGreaterThanOrEqual(88 * STRIP_MIN_VISIBLE_PEEK_FRACTION);
  });

  it("clamps adjusted gap to at most ~2.5× preferred while staying strong", () => {
    const preferredGapPx = 70;
    const viewportWidthPx = 500;
    const itemWidthPx = 88;

    const gap = resolveOverflowStripGapPx({
      viewportWidthPx,
      itemWidthPx,
      preferredGapPx,
    });

    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(preferredGapPx * 2.5 + 1e-9);
    expectStrongPeek(viewportWidthPx, itemWidthPx, gap);
  });
});
