/**
 * Overflow-only peek-safe gap for the landing coworker strip.
 *
 * When the strip overflows and a middle chip is optically centered, each
 * scrollport edge should intersect a chip (peek-cut), not land in gap/empty.
 *
 * With centered item width `itemW` and viewport `Vp`:
 * `d = Vp/2 - itemW/2`, `rem = d % (itemW + g)` — edge is in a chip iff `rem >= g`.
 */

export interface ResolveOverflowStripGapPxInput {
  viewportWidthPx: number;
  itemWidthPx: number;
  preferredGapPx: number;
  /** Upper bound as a multiple of preferred; default 1.5. */
  maxGapFactor?: number;
}

/**
 * True when a middle-centered layout peeks a chip at each scrollport edge.
 */
export function isOverflowStripGapPeekSafe(
  viewportWidthPx: number,
  itemWidthPx: number,
  gapPx: number,
): boolean {
  if (!(viewportWidthPx > 0) || !(itemWidthPx > 0) || !(gapPx > 0)) {
    return false;
  }

  const d = viewportWidthPx / 2 - itemWidthPx / 2;
  if (!(d > 0)) {
    // Degenerate half-viewport geometry — nothing useful to adjust.
    return false;
  }

  const period = itemWidthPx + gapPx;
  const rem = d % period;
  return rem >= gapPx;
}

/**
 * Returns preferred gap when already peek-safe; otherwise a closed-form gap
 * aimed at half-chip peek (`rem ≈ g + itemW/2`), clamped to (0, maxGap].
 */
export function resolveOverflowStripGapPx({
  viewportWidthPx,
  itemWidthPx,
  preferredGapPx,
  maxGapFactor = 1.5,
}: ResolveOverflowStripGapPxInput): number {
  const preferred = preferredGapPx;
  if (
    preferred > 0 &&
    isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, preferred)
  ) {
    return preferred;
  }

  const d = viewportWidthPx / 2 - itemWidthPx / 2;
  if (!(d > 0) || !(itemWidthPx > 0) || !(preferred > 0)) {
    return Math.max(preferred, Number.MIN_VALUE);
  }

  const maxGap = preferred * maxGapFactor;
  const maxK = Math.max(0, Math.floor(d / itemWidthPx) + 1);

  let bestGap: null | number = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  function consider(gap: number): void {
    if (!(gap > 0) || gap > maxGap) {
      return;
    }
    if (!isOverflowStripGapPeekSafe(viewportWidthPx, itemWidthPx, gap)) {
      return;
    }
    const distance = Math.abs(gap - preferred);
    if (distance < bestDistance) {
      bestDistance = distance;
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

  if (bestGap !== null) {
    return bestGap;
  }

  // Fallback: other chip-band fractions, then dense sample within the clamp.
  const fractions = [0, 0.25, 0.75, 0.9] as const;
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

  const sampleSteps = 48;
  for (let step = 1; step <= sampleSteps; step += 1) {
    consider((maxGap * step) / sampleSteps);
  }

  return bestGap ?? preferred;
}
