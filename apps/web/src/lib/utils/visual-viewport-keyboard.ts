/**
 * Soft-keyboard heuristic for iOS Safari / standalone PWA and Android.
 *
 * iOS often keeps `window.innerHeight` in sync with the visual viewport, so a
 * plain `innerHeight - visualViewport.height` delta stays ~0. Prefer:
 * - session max layout height vs visual bottom (`height + offsetTop`)
 * - `documentElement.clientHeight` when it stays larger than the visual viewport
 * - layout shrink vs baseline when `interactive-widget: resizes-content` fires
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

export interface VisualViewportKeyboardOpenOptions {
  thresholdPx?: number;
  maxLayoutHeightPx?: number;
  /** iOS scrolls the visual viewport; include when known. */
  visualViewportOffsetTop?: number;
  /** Stable layout height; iOS often keeps this while vv shrinks. */
  clientHeight?: number;
}

export function isVisualViewportKeyboardOpen(
  layoutHeight: number,
  visualViewportHeight: number | null | undefined,
  options?: VisualViewportKeyboardOpenOptions,
): boolean {
  const thresholdPx =
    options?.thresholdPx ?? VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX;
  const baseline = options?.maxLayoutHeightPx ?? layoutHeight;
  const offsetTop = options?.visualViewportOffsetTop ?? 0;
  const clientHeight = options?.clientHeight ?? layoutHeight;

  if (visualViewportHeight == null) {
    return baseline - layoutHeight > thresholdPx;
  }

  const visualDelta = layoutHeight - visualViewportHeight;
  const clientDelta = clientHeight - visualViewportHeight;
  const layoutShrink = baseline - layoutHeight;
  // Visible span in layout coordinates; keyboard covers everything below.
  const obscured = baseline - (visualViewportHeight + offsetTop);

  return (
    visualDelta > thresholdPx ||
    clientDelta > thresholdPx ||
    layoutShrink > thresholdPx ||
    obscured > thresholdPx
  );
}

export function readVisualViewportKeyboardOpen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const clientHeight = document.documentElement.clientHeight;
  const layoutHeight = Math.max(window.innerHeight, clientHeight);
  if (layoutHeight > maxLayoutHeightPx) {
    maxLayoutHeightPx = layoutHeight;
  }

  const visualViewport = window.visualViewport;

  return isVisualViewportKeyboardOpen(
    window.innerHeight,
    visualViewport?.height,
    {
      maxLayoutHeightPx,
      clientHeight,
      visualViewportOffsetTop: visualViewport?.offsetTop,
    },
  );
}
