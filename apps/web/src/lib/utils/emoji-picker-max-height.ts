export const EMOJI_PICKER_MAX_HEIGHT_CAP_PX = 360;
export const EMOJI_PICKER_MIN_GRID_HEIGHT_PX = 120;
export const EMOJI_PICKER_VIEWPORT_MARGIN_PX = 16;
/** Nav + search chrome estimate when measured height is unavailable. */
export const EMOJI_PICKER_CHROME_ESTIMATE_PX = 108;

export interface ResolveEmojiPickerMaxHeightPxInput {
  visualViewportHeightPx: number;
  chromePx: number;
  capPx?: number;
  minGridPx?: number;
  viewportMarginPx?: number;
}

/**
 * Keyboard-aware max height for the emoji picker popover.
 * Prefers fitting the visual viewport, but never goes below chrome+minGrid
 * so nav/search + the min scroll region stay usable under a soft keyboard.
 */
export function resolveEmojiPickerMaxHeightPx({
  visualViewportHeightPx,
  chromePx,
  capPx = EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  minGridPx = EMOJI_PICKER_MIN_GRID_HEIGHT_PX,
  viewportMarginPx = EMOJI_PICKER_VIEWPORT_MARGIN_PX,
}: ResolveEmojiPickerMaxHeightPxInput): number {
  const available = Math.max(0, visualViewportHeightPx - viewportMarginPx);
  const minTotal = chromePx + minGridPx;
  if (available < minTotal) return minTotal;
  return Math.min(capPx, available);
}
