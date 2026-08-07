import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isEditableKeyboardTarget,
  isVisualViewportKeyboardOpen,
  readVisualViewportKeyboardOpen,
  resetVisualViewportKeyboardBaseline,
  VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX,
} from "../visual-viewport-keyboard";

describe("isEditableKeyboardTarget", () => {
  it("accepts textarea, input, select, and contentEditable", () => {
    const textarea = document.createElement("textarea");
    const input = document.createElement("input");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isEditableKeyboardTarget(textarea)).toBe(true);
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(select)).toBe(true);
    expect(isEditableKeyboardTarget(editable)).toBe(true);
  });

  it("rejects non-editables", () => {
    expect(isEditableKeyboardTarget(document.createElement("div"))).toBe(false);
    expect(isEditableKeyboardTarget(null)).toBe(false);
  });
});

describe("isVisualViewportKeyboardOpen", () => {
  it("is false when no editable is focused (autofocus / idle)", () => {
    expect(
      isVisualViewportKeyboardOpen(400, 400, {
        editableFocused: false,
        maxLayoutHeightPx: 800,
        maxVisualHeightPx: 800,
      }),
    ).toBe(false);
  });

  it("is false when focused but the viewport has not shrunk past the threshold", () => {
    expect(
      isVisualViewportKeyboardOpen(800, 700, {
        editableFocused: true,
        maxLayoutHeightPx: 800,
        maxVisualHeightPx: 800,
      }),
    ).toBe(false);
  });

  it("is true when focused and visual height shrinks past the threshold", () => {
    expect(
      isVisualViewportKeyboardOpen(800, 400, {
        editableFocused: true,
        maxLayoutHeightPx: 800,
        maxVisualHeightPx: 800,
      }),
    ).toBe(true);
    expect(
      isVisualViewportKeyboardOpen(
        800,
        800 - VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX - 1,
        {
          editableFocused: true,
          maxLayoutHeightPx: 800,
          maxVisualHeightPx: 800,
        },
      ),
    ).toBe(true);
  });

  it("is true when focused and layout shrinks vs baseline (resizes-content)", () => {
    expect(
      isVisualViewportKeyboardOpen(500, 500, {
        editableFocused: true,
        maxLayoutHeightPx: 800,
        maxVisualHeightPx: 800,
      }),
    ).toBe(true);
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
    vi.spyOn(document.documentElement, "clientHeight", "get").mockRestore();
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  function stubViewport(layout: number, visual: number) {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: layout,
    });
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
      layout,
    );
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: { height: visual, offsetTop: 0 },
    });
  }

  it("stays false on autofocus when the viewport has not shrunk", () => {
    stubViewport(800, 800);
    expect(readVisualViewportKeyboardOpen()).toBe(false);

    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    expect(readVisualViewportKeyboardOpen()).toBe(false);
    textarea.remove();
  });

  it("becomes true when an editable is focused and the visual viewport shrinks", () => {
    stubViewport(800, 800);
    expect(readVisualViewportKeyboardOpen()).toBe(false);

    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    stubViewport(800, 400);
    expect(readVisualViewportKeyboardOpen()).toBe(true);
    textarea.remove();
  });

  it("stays false when the viewport shrinks but nothing editable is focused", () => {
    stubViewport(800, 800);
    expect(readVisualViewportKeyboardOpen()).toBe(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
    stubViewport(500, 500);
    expect(isEditableKeyboardTarget(document.activeElement)).toBe(false);
    expect(readVisualViewportKeyboardOpen()).toBe(false);
  });
});
