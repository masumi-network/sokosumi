import { describe, expect, it } from "vitest";

import { DYNAMIC_TYPE_MAX_ROOT_PX } from "@/lib/utils/dynamic-type";
import {
  EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  estimateEmojiPickerChromePx,
  estimateEmojiPickerMinGridPx,
  estimateEmojiPickerMinTotalPx,
  resolveEmojiPickerMaxHeightPx,
} from "../emoji-picker-max-height";

const root16 = 16;
const root20 = DYNAMIC_TYPE_MAX_ROOT_PX; // 1.25× Dynamic Type cap
const chrome16 = estimateEmojiPickerChromePx(root16);
const minGrid16 = estimateEmojiPickerMinGridPx(root16);
const minTotal16 = estimateEmojiPickerMinTotalPx(root16);
const minTotal20 = estimateEmojiPickerMinTotalPx(root20);

describe("emoji picker rem-scaled chrome/grid estimates", () => {
  it("matches default-root chrome+grid (5.5rem + 2px + 7.5rem)", () => {
    expect(chrome16).toBe(5.5 * 16 + 2);
    expect(minGrid16).toBe(7.5 * 16);
    expect(minTotal16).toBe(210);
  });

  it("scales to ~262px at 1.25× Dynamic Type (20px root)", () => {
    expect(estimateEmojiPickerChromePx(root20)).toBe(5.5 * 20 + 2);
    expect(estimateEmojiPickerMinGridPx(root20)).toBe(7.5 * 20);
    expect(minTotal20).toBe(262);
  });
});

describe("resolveEmojiPickerMaxHeightPx", () => {
  it("caps at 360 on a tall viewport", () => {
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 900,
        chromePx: chrome16,
        minGridPx: minGrid16,
      }),
    ).toBe(EMOJI_PICKER_MAX_HEIGHT_CAP_PX);
  });

  it("floors at rem-scaled minTotal when the keyboard shrinks below chrome+minGrid", () => {
    const visualViewportHeightPx = 150;
    const available = visualViewportHeightPx - 16;
    expect(available).toBeLessThan(minTotal16);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx,
        chromePx: chrome16,
        minGridPx: minGrid16,
      }),
    ).toBe(minTotal16);
  });

  it("floors at 262px under 1.25× Dynamic Type when available is 228–261", () => {
    // Old fixed 108+120 floor was 228; rem-scaled floor is 262.
    for (const visualViewportHeightPx of [244, 260, 276]) {
      const available = visualViewportHeightPx - 16;
      expect(available).toBeGreaterThanOrEqual(228);
      expect(available).toBeLessThan(minTotal20);
      expect(
        resolveEmojiPickerMaxHeightPx({
          visualViewportHeightPx,
          chromePx: estimateEmojiPickerChromePx(root20),
          minGridPx: estimateEmojiPickerMinGridPx(root20),
        }),
      ).toBe(minTotal20);
    }
  });

  it("never exceeds available when available is at least minTotal", () => {
    for (const visualViewportHeightPx of [250, 300, 400, 800]) {
      const available = Math.max(0, visualViewportHeightPx - 16);
      expect(available).toBeGreaterThanOrEqual(minTotal16);
      const result = resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx,
        chromePx: chrome16,
        minGridPx: minGrid16,
      });
      expect(result).toBeLessThanOrEqual(available);
    }
  });

  it("falls back to minTotal when available is zero or negative", () => {
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 0,
        chromePx: chrome16,
        minGridPx: minGrid16,
      }),
    ).toBe(minTotal16);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: 8,
        chromePx: chrome16,
        minGridPx: minGrid16,
        viewportMarginPx: 16,
      }),
    ).toBe(minTotal16);
    expect(
      resolveEmojiPickerMaxHeightPx({
        visualViewportHeightPx: -20,
        chromePx: chrome16,
        minGridPx: minGrid16,
      }),
    ).toBe(minTotal16);
  });
});
