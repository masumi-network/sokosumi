/**
 * Soft-keyboard heuristic for iOS Safari / standalone PWA and Android.
 *
 * - iOS / overlay keyboards: layout height stays put; visualViewport shrinks.
 * - `interactive-widget: resizes-content` (Android Chrome): layout shrinks too,
 *   so also compare against the largest layout height seen this session.
 *
 * URL-bar chrome is smaller than a keyboard — threshold avoids most false positives.
 */
export const VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX = 150;

/** Largest layout viewport height seen; used when the layout itself resizes. */
let maxLayoutHeightPx = 0;

/** Test / HMR helper — resets the layout baseline. */
export function resetVisualViewportKeyboardBaseline(): void {
  maxLayoutHeightPx = 0;
}

export function isVisualViewportKeyboardOpen(
  layoutHeight: number,
  visualViewportHeight: number | null | undefined,
  options?: {
    thresholdPx?: number;
    maxLayoutHeightPx?: number;
  },
): boolean {
  const thresholdPx =
    options?.thresholdPx ?? VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX;
  const baseline = options?.maxLayoutHeightPx ?? layoutHeight;

  const visualDelta =
    visualViewportHeight == null ? 0 : layoutHeight - visualViewportHeight;
  const layoutShrink = baseline - layoutHeight;

  return visualDelta > thresholdPx || layoutShrink > thresholdPx;
}

export function readVisualViewportKeyboardOpen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const layoutHeight = window.innerHeight;
  if (layoutHeight > maxLayoutHeightPx) {
    maxLayoutHeightPx = layoutHeight;
  }

  return isVisualViewportKeyboardOpen(
    layoutHeight,
    window.visualViewport?.height,
    { maxLayoutHeightPx },
  );
}
