import { describe, expect, it } from "vitest";

import {
  EMOJI_PICKER_CHROME_ESTIMATE_PX,
  EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  EMOJI_PICKER_MIN_GRID_HEIGHT_PX,
  resolveEmojiPickerMaxHeightPx,
} from "../emoji-picker-max-height";

const chromePx = EMOJI_PICKER_CHROME_ESTIMATE_PX;
const minTotal = chromePx + EMOJI_PICKER_MIN_GRID_HEIGHT_PX;

describe("resolveEmojiPickerMaxHeightPx", () => {
  it("caps at 360 on a tall viewport", () => {
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 900,
        chromePx,
      }),
    ).toBe(EMOJI_PICKER_MAX_HEIGHT_CAP_PX);
  });

  it("floors at minTotal when the keyboard shrinks below chrome+minGrid", () => {
    const visualViewportHeightPx = 150;
    const available = visualViewportHeightPx - 16;
    expect(available).toBeLessThan(minTotal);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx,
        chromePx,
      }),
    ).toBe(minTotal);
  });

  it("never exceeds available when available is at least minTotal", () => {
    for (const visualViewportHeightPx of [250, 300, 400, 800]) {
      const available = Math.max(0, visualViewportHeightPx - 16);
      expect(available).toBeGreaterThanOrEqual(minTotal);
      const result = resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx,
        chromePx,
      });
      expect(result).toBeLessThanOrEqual(available);
    }
  });

  it("falls back to minTotal when available is zero or negative", () => {
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 0,
        chromePx,
      }),
    ).toBe(minTotal);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 8,
        chromePx,
        viewportMarginPx: 16,
      }),
    ).toBe(minTotal);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: -20,
        chromePx,
      }),
    ).toBe(minTotal);
  });
});
