import { describe, expect, it } from "vitest";

import {
  isOverflowStripGapPeekSafe,
  overflowStripEdgePeekPx,
  resolveOverflowStripGapPx,
  STRIP_MIN_PEEK_FRACTION,
} from "../peek-safe-strip-gap";

/**
 * Strong peek: visible depth in `[minPeek, itemW - minPeek]` so edges are
 * neither a 4px sliver nor a 4px haircut on a fully framed face.
 */
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
  const minPeekPx = itemWidthPx * STRIP_MIN_PEEK_FRACTION;
  expect(peekPx!).toBeGreaterThanOrEqual(minPeekPx);
  expect(peekPx!).toBeLessThanOrEqual(itemWidthPx - minPeekPx);
}

describe("overflowStripEdgePeekPx", () => {
  it("returns null when the edge lands in the gap band", () => {
    // d=105, period=100, rem=5 < g=20
    expect(overflowStripEdgePeekPx(290, 80, 20)).toBeNull();
  });

  it("returns visible chip depth when the edge cuts a chip", () => {
    // d=151, period=104, rem=47 → peek=31
    expect(overflowStripEdgePeekPx(390, 88, 16)).toBeCloseTo(31, 5);
  });
});

describe("isOverflowStripGapPeekSafe", () => {
  it("is true for a mid-chip peek (mobile compact ballpark)", () => {
    // rem=47, peek=31 ≥ 0.35*88≈30.8 and ≤ 57.2
    expect(isOverflowStripGapPeekSafe(390, 88, 16)).toBe(true);
  });

  it("is false when rem lands in the gap band", () => {
    expect(isOverflowStripGapPeekSafe(290, 80, 20)).toBe(false);
  });

  it("is false for a tiny visible sliver", () => {
    // Construct rem ≈ g + 4 → peek=4 ≪ 0.35*W
    // d=124, W=80, g=20 → period=100, rem=24, peek=4
    expect(overflowStripEdgePeekPx(328, 80, 20)).toBeCloseTo(4, 5);
    expect(isOverflowStripGapPeekSafe(328, 80, 20)).toBe(false);
  });

  it("is false for a near-full chip with only a haircut (desktop failure mode)", () => {
    // max-w-4xl ~896, default chip 112, preferred gap 20 → peek=108
    // (only 4px clipped) — looks fully framed.
    expect(overflowStripEdgePeekPx(896, 112, 20)).toBeCloseTo(108, 5);
    expect(isOverflowStripGapPeekSafe(896, 112, 20)).toBe(false);
  });
});

describe("resolveOverflowStripGapPx", () => {
  it("returns preferred when it already has a strong peek", () => {
    expect(
      resolveOverflowStripGapPx({
        viewportWidthPx: 390,
        itemWidthPx: 88,
        preferredGapPx: 16,
      }),
    ).toBe(16);
  });

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

  it("strengthens desktop max-w-4xl peek beyond a 4px haircut", () => {
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
    // Same ballpark as mobile (~half chip), not a 4px cue.
    expect(peekPx).toBeGreaterThanOrEqual(itemWidthPx * 0.35);
    expect(peekPx).toBeLessThanOrEqual(itemWidthPx * 0.65);
  });

  it("keeps mobile 375 compact peek at least as strong as the QA baseline", () => {
    const gap = resolveOverflowStripGapPx({
      viewportWidthPx: 375,
      itemWidthPx: 88,
      preferredGapPx: 16,
    });

    expect(gap).toBeGreaterThan(0);
    expectStrongPeek(375, 88, gap);

    const peekPx = overflowStripEdgePeekPx(375, 88, gap)!;
    // QA saw ~72px with a weak rule; strong band floor is 0.35*88≈30.8, but
    // prefer mid-chip so we stay well above a sliver.
    expect(peekPx).toBeGreaterThanOrEqual(88 * STRIP_MIN_PEEK_FRACTION);
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
