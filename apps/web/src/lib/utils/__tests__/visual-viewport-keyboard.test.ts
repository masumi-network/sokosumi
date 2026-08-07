import { afterEach, describe, expect, it } from "vitest";

import {
  isVisualViewportKeyboardOpen,
  readVisualViewportKeyboardOpen,
  resetVisualViewportKeyboardBaseline,
  VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX,
} from "../visual-viewport-keyboard";

describe("isVisualViewportKeyboardOpen", () => {
  it("is false when visualViewport height is missing and layout is stable", () => {
    expect(isVisualViewportKeyboardOpen(800, null)).toBe(false);
    expect(isVisualViewportKeyboardOpen(800, undefined)).toBe(false);
  });

  it("is false when the height delta is at or below the threshold", () => {
    expect(
      isVisualViewportKeyboardOpen(
        800,
        800 - VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX,
      ),
    ).toBe(false);
    expect(isVisualViewportKeyboardOpen(800, 700)).toBe(false);
  });

  it("is true when the visualViewport delta exceeds the threshold", () => {
    expect(
      isVisualViewportKeyboardOpen(
        800,
        800 - VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX - 1,
      ),
    ).toBe(true);
    expect(isVisualViewportKeyboardOpen(800, 400)).toBe(true);
  });

  it("is true when layout shrinks vs baseline (resizes-content)", () => {
    expect(
      isVisualViewportKeyboardOpen(500, 500, { maxLayoutHeightPx: 800 }),
    ).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(isVisualViewportKeyboardOpen(800, 650, { thresholdPx: 100 })).toBe(
      true,
    );
    expect(isVisualViewportKeyboardOpen(800, 650, { thresholdPx: 200 })).toBe(
      false,
    );
  });
});

describe("readVisualViewportKeyboardOpen", () => {
  const originalInnerHeight = window.innerHeight;
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    resetVisualViewportKeyboardBaseline();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: originalVisualViewport,
    });
  });

  it("tracks layout baseline so resizes-content still detects the keyboard", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: { height: 800 },
    });
    expect(readVisualViewportKeyboardOpen()).toBe(false);

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 500,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: { height: 500 },
    });
    expect(readVisualViewportKeyboardOpen()).toBe(true);
  });
});
