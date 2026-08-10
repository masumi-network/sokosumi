import { DYNAMIC_TYPE_DEFAULT_ROOT_PX } from "@/lib/utils/dynamic-type";

export const EMOJI_PICKER_MAX_HEIGHT_CAP_PX = 360;
export const EMOJI_PICKER_VIEWPORT_MARGIN_PX = 16;

/**
 * Matches `min-h-[7.5rem]` on the emoji scroll region.
 * Scales with Dynamic Type root rem.
 */
export const EMOJI_PICKER_MIN_GRID_HEIGHT_REM = 7.5;

/**
 * Nav (`size-8` + `py-1`) + search (`h-8` + `p-2`) in rem.
 * Borders are fixed px — see {@link EMOJI_PICKER_CHROME_BORDER_PX}.
 */
export const EMOJI_PICKER_CHROME_ESTIMATE_REM = 5.5;

/** `border-b` on nav + search rows (1px each). */
export const EMOJI_PICKER_CHROME_BORDER_PX = 2;

export interface ResolveEmojiPickerMaxHeightPxInput {
  visualViewportHeightPx: number;
  chromePx: number;
  capPx?: number;
  minGridPx?: number;
  viewportMarginPx?: number;
}

export function remToPx(
  rem: number,
  rootFontSizePx: number = DYNAMIC_TYPE_DEFAULT_ROOT_PX,
): number {
  return rem * rootFontSizePx;
}

export function estimateEmojiPickerChromePx(
  rootFontSizePx: number = DYNAMIC_TYPE_DEFAULT_ROOT_PX,
): number {
  return (
    remToPx(EMOJI_PICKER_CHROME_ESTIMATE_REM, rootFontSizePx) +
    EMOJI_PICKER_CHROME_BORDER_PX
  );
}

export function estimateEmojiPickerMinGridPx(
  rootFontSizePx: number = DYNAMIC_TYPE_DEFAULT_ROOT_PX,
): number {
  return remToPx(EMOJI_PICKER_MIN_GRID_HEIGHT_REM, rootFontSizePx);
}

export function estimateEmojiPickerMinTotalPx(
  rootFontSizePx: number = DYNAMIC_TYPE_DEFAULT_ROOT_PX,
): number {
  return (
    estimateEmojiPickerChromePx(rootFontSizePx) +
    estimateEmojiPickerMinGridPx(rootFontSizePx)
  );
}

/**
 * Keyboard-aware max height for the emoji picker popover.
 * Prefers fitting the visual viewport, but never goes below chrome+minGrid
 * so nav/search + the min scroll region stay usable under a soft keyboard.
 * Pass rem-scaled chrome/minGrid (via {@link estimateEmojiPickerChromePx} /
 * {@link estimateEmojiPickerMinGridPx}) so Dynamic Type does not under-floor.
 */
export function resolveEmojiPickerMaxHeightPx({
  visualViewportHeightPx,
  chromePx,
  capPx = EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  minGridPx,
  viewportMarginPx = EMOJI_PICKER_VIEWPORT_MARGIN_PX,
}: ResolveEmojiPickerMaxHeightPxInput): number {
  const resolvedMinGridPx =
    minGridPx ?? estimateEmojiPickerMinGridPx(DYNAMIC_TYPE_DEFAULT_ROOT_PX);
  const available = Math.max(0, visualViewportHeightPx - viewportMarginPx);
  const minTotal = chromePx + resolvedMinGridPx;
  if (available < minTotal) return minTotal;
  return Math.min(capPx, available);
}

export function readRootFontSizePx(
  root: HTMLElement = document.documentElement,
): number {
  const parsed = Number.parseFloat(globalThis.getComputedStyle(root).fontSize);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DYNAMIC_TYPE_DEFAULT_ROOT_PX;
  }
  return parsed;
}
