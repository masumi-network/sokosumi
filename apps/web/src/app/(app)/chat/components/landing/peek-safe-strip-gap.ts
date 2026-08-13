/**
 * Overflow-only peek-safe gap for the landing coworker strip.
 *
 * When the strip overflows and a middle chip is optically centered, each
 * scrollport edge should show a *meaningful* slice of a neighbor chip — not
 * land in gap/empty, and not leave only a 4px sliver or a 4px haircut on an
 * otherwise fully framed face.
 *
 * With centered item width `itemW` and viewport `Vp`:
 * `d = Vp/2 - itemW/2`, `rem = d % (itemW + g)`.
 * Edge is in a chip iff `rem >= g`; visible chip depth is `rem - g`.
 */

/** Minimum visible fraction of the edge chip (reject tiny slivers). */
export const STRIP_MIN_VISIBLE_PEEK_FRACTION = 0.4;
/**
 * Minimum clipped fraction (reject a 4px haircut on an otherwise full face).
 * Visible band is `[minVisible, 1 - minClip]`.
 */
export const STRIP_MIN_CLIP_FRACTION = 0.25;
/** Aim near the mobile QA ballpark (~0.65 of a chip visible). */
export const STRIP_TARGET_PEEK_FRACTION = 0.65;

/** @deprecated Use STRIP_MIN_VISIBLE_PEEK_FRACTION. */
export const STRIP_MIN_PEEK_FRACTION = STRIP_MIN_VISIBLE_PEEK_FRACTION;

export interface ResolveOverflowStripGapPxInput {
  viewportWidthPx: number;
  itemWidthPx: number;
  preferredGapPx: number;
  /**
   * Upper bound as a multiple of preferred. Default 2.5 so wide desktop
   * scrollports can still reach a strong peek.
   */
  maxGapFactor?: number;
  minVisibleFraction?: number;
  minClipFraction?: number;
  targetPeekFraction?: number;
}

/**
 * Visible depth (px) of the chip under each scrollport edge when a middle
 * chip is optically centered, or `null` when the edge lands in gap/empty.
 */
export function overflowStripEdgePeekPx(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
): null | number {
  if (!(viewportWidthPx > 0) || !(itemWidthPx > 0) || !(gapPx > 0)) {
    return null;
  }

  const d = viewportWidthPx / 2 - itemWidthPx / 2;
  if (!(d > 0)) {
    return null;
  }

  const period = itemWidthPx + gapPx;
  const rem = d % period;
  if (rem < gapPx) {
    return null;
  }

  return rem - gapPx;
}

/**
 * True when a middle-centered layout shows a strong peek at each scrollport
 * edge (enough visible chunk and enough clipped that it is not a haircut).
 */
export function isOverflowStripGapPeekSafe(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
  minVisibleFraction: number = STRIP_MIN_VISIBLE_PEEK_FRACTION,
  minClipFraction: number = STRIP_MIN_CLIP_FRACTION,
): boolean {
  const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gapPx);
  if (peekPx === null) {
    return false;
  }

  const minVisiblePx = itemWidthPx * minVisibleFraction;
  const minClipPx = itemWidthPx * minClipFraction;
  return peekPx >= minVisiblePx && itemWidthPx - peekPx >= minClipPx;
}

/**
 * Returns preferred gap when already strongly peek-safe; otherwise aims for
 * ~65% chip visible (mobile QA ballpark), clamped to (0, maxGap].
 */
export function resolveOverflowStripGapPx({
  viewportWidthPx,
  itemWidthPx,
  preferredGapPx,
  maxGapFactor = 2.5,
  minVisibleFraction = STRIP_MIN_VISIBLE_PEEK_FRACTION,
  minClipFraction = STRIP_MIN_CLIP_FRACTION,
  targetPeekFraction = STRIP_TARGET_PEEK_FRACTION,
}: ResolveOverflowStripGapPxInput): number {
  const preferred = preferredGapPx;
  if (
    preferred > 0 &&
    isOverflowStripGapPeekSafe(
      viewportWidthPx,
      itemWidthPx,
      preferred,
      minVisibleFraction,
      minClipFraction,
    )
  ) {
    return preferred;
  }

  const d = viewportWidthPx / 2 - itemWidthPx / 2;
  if (!(d > 0) || !(itemWidthPx > 0) || !(preferred > 0)) {
    return Math.max(preferred, Number.MIN_VALUE);
  }

  const maxGap = preferred * maxGapFactor;
  const minGap = preferred * 0.5;
  const maxK = Math.max(0, Math.floor(d / itemWidthPx) + 1);
  const targetPeekPx = itemWidthPx * targetPeekFraction;

  let bestGap: null | number = null;
  let bestPeekDistance = Number.POSITIVE_INFINITY;
  let bestGapDistance = Number.POSITIVE_INFINITY;

  function consider(gap: number): void {
    if (!(gap >= minGap) || gap > maxGap) {
      return;
    }
    if (
      !isOverflowStripGapPeekSafe(
        viewportWidthPx,
        itemWidthPx,
        gap,
        minVisibleFraction,
        minClipFraction,
      )
    ) {
      return;
    }

    const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gap);
    if (peekPx === null) {
      return;
    }

    const peekDistance = Math.abs(peekPx - targetPeekPx);
    const gapDistance = Math.abs(gap - preferred);
    const betterPeek = peekDistance < bestPeekDistance - 1e-9;
    const samePeekCloserGap =
      Math.abs(peekDistance - bestPeekDistance) <= 1e-9 &&
      gapDistance < bestGapDistance;

    if (betterPeek || samePeekCloserGap) {
      bestPeekDistance = peekDistance;
      bestGapDistance = gapDistance;
      bestGap = gap;
    }
  }

  // Closed form toward target peek: rem = g + targetPeek
  // d = k*(itemW+g) + g + targetPeek → g = (d - itemW*k - targetPeek) / (k+1)
  for (let k = 0; k <= maxK; k += 1) {
    const gap = (d - itemWidthPx * k - targetPeekPx) / (k + 1);
    const period = itemWidthPx + gap;
    if (!(period > 0) || Math.floor(d / period) !== k) {
      continue;
    }
    consider(gap);
  }

  const fractions = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.35] as const;
  for (let k = 0; k <= maxK; k += 1) {
    for (const fraction of fractions) {
      const gap = (d - itemWidthPx * (k + fraction)) / (k + 1);
      const period = itemWidthPx + gap;
      if (!(period > 0) || Math.floor(d / period) !== k) {
        continue;
      }
      consider(gap);
    }
  }

  const sampleSteps = 64;
  for (let step = 0; step <= sampleSteps; step += 1) {
    consider(minGap + ((maxGap - minGap) * step) / sampleSteps);
  }

  if (bestGap !== null) {
    return bestGap;
  }

  let effortGap: null | number = null;
  let effortPeekDistance = Number.POSITIVE_INFINITY;
  let effortGapDistance = Number.POSITIVE_INFINITY;

  function considerEffort(gap: number): void {
    if (!(gap >= minGap) || gap > maxGap) {
      return;
    }
    const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gap);
    if (peekPx === null || !(peekPx > 0)) {
      return;
    }
    const peekDistance = Math.abs(peekPx - targetPeekPx);
    const gapDistance = Math.abs(gap - preferred);
    const betterPeek = peekDistance < effortPeekDistance - 1e-9;
    const samePeekCloserGap =
      Math.abs(peekDistance - effortPeekDistance) <= 1e-9 &&
      gapDistance < effortGapDistance;
    if (betterPeek || samePeekCloserGap) {
      effortPeekDistance = peekDistance;
      effortGapDistance = gapDistance;
      effortGap = gap;
    }
  }

  for (let step = 0; step <= sampleSteps; step += 1) {
    considerEffort(minGap + ((maxGap - minGap) * step) / sampleSteps);
  }

  return effortGap ?? preferred;
}
