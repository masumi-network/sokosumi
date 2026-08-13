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

/** Minimum visible (and clipped) fraction of the edge chip. */
export const STRIP_MIN_PEEK_FRACTION = 0.35;

export interface ResolveOverflowStripGapPxInput {
  viewportWidthPx: number;
  itemWidthPx: number;
  preferredGapPx: number;
  /**
   * Upper bound as a multiple of preferred. Default 2.5 so wide desktop
   * scrollports can still reach a mid-chip peek.
   */
  maxGapFactor?: number;
  /** Override for tests; default `STRIP_MIN_PEEK_FRACTION`. */
  minPeekFraction?: number;
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
 * edge (visible depth in `[minPeek, itemW - minPeek]`).
 */
export function isOverflowStripGapPeekSafe(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
  minPeekFraction: number = STRIP_MIN_PEEK_FRACTION,
): boolean {
  const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gapPx);
  if (peekPx === null) {
    return false;
  }

  const minPeekPx = itemWidthPx * minPeekFraction;
  return peekPx >= minPeekPx && peekPx <= itemWidthPx - minPeekPx;
}

/**
 * Returns preferred gap when already strongly peek-safe; otherwise a
 * closed-form gap aimed at half-chip peek (`rem ≈ g + itemW/2`), clamped to
 * (0, maxGap]. Prefers mid-chip peeks, then proximity to preferred gap.
 */
export function resolveOverflowStripGapPx({
  viewportWidthPx,
  itemWidthPx,
  preferredGapPx,
  maxGapFactor = 2.5,
  minPeekFraction = STRIP_MIN_PEEK_FRACTION,
}: ResolveOverflowStripGapPxInput): number {
  const preferred = preferredGapPx;
  if (
    preferred > 0 &&
    isOverflowStripGapPeekSafe(
      viewportWidthPx,
      itemWidthPx,
      preferred,
      minPeekFraction,
    )
  ) {
    return preferred;
  }

  const d = viewportWidthPx / 2 - itemWidthPx / 2;
  if (!(d > 0) || !(itemWidthPx > 0) || !(preferred > 0)) {
    return Math.max(preferred, Number.MIN_VALUE);
  }

  const maxGap = preferred * maxGapFactor;
  const maxK = Math.max(0, Math.floor(d / itemWidthPx) + 1);
  const halfChip = itemWidthPx / 2;

  let bestGap: null | number = null;
  let bestPeekDistance = Number.POSITIVE_INFINITY;
  let bestGapDistance = Number.POSITIVE_INFINITY;

  function consider(gap: number): void {
    if (!(gap > 0) || gap > maxGap) {
      return;
    }
    if (
      !isOverflowStripGapPeekSafe(
        viewportWidthPx,
        itemWidthPx,
        gap,
        minPeekFraction,
      )
    ) {
      return;
    }

    const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gap);
    if (peekPx === null) {
      return;
    }

    const peekDistance = Math.abs(peekPx - halfChip);
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

  // Closed form toward half-chip peek: rem = g + itemW/2
  // d = k*(itemW+g) + g + itemW/2  →  g = (d - itemW*(k+0.5)) / (k+1)
  for (let k = 0; k <= maxK; k += 1) {
    const gap = (d - itemWidthPx * (k + 0.5)) / (k + 1);
    const period = itemWidthPx + gap;
    if (!(period > 0) || Math.floor(d / period) !== k) {
      continue;
    }
    consider(gap);
  }

  // Nearby peek fractions, then dense sample within the clamp.
  const fractions = [0.35, 0.4, 0.45, 0.55, 0.6, 0.65, 0.25, 0.75] as const;
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
  for (let step = 1; step <= sampleSteps; step += 1) {
    consider((maxGap * step) / sampleSteps);
  }

  if (bestGap !== null) {
    return bestGap;
  }

  // Best-effort when no gap hits the strong band within the clamp: pick the
  // positive peek closest to half-chip (still better than a 4px haircut).
  let effortGap: null | number = null;
  let effortPeekDistance = Number.POSITIVE_INFINITY;
  let effortGapDistance = Number.POSITIVE_INFINITY;

  function considerEffort(gap: number): void {
    if (!(gap > 0) || gap > maxGap) {
      return;
    }
    const peekPx = overflowStripEdgePeekPx(viewportWidthPx, itemWidthPx, gap);
    if (peekPx === null || !(peekPx > 0)) {
      return;
    }
    const peekDistance = Math.abs(peekPx - halfChip);
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

  for (let step = 1; step <= sampleSteps; step += 1) {
    considerEffort((maxGap * step) / sampleSteps);
  }

  return effortGap ?? preferred;
}
