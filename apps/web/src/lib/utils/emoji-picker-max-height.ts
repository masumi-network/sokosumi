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
 * Keyboard-safe max height for the emoji picker popover.
 * Stays within the visual viewport; when the keyboard leaves less than
 * chrome+minGrid, uses the remaining budget (best effort).
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
  if (available <= 0) return minTotal;
  if (available < minTotal) return available;
  return Math.min(capPx, available);
}
