import { describe, expect, it } from "vitest";

import {
  applyDynamicTypeRootCap,
  clampRootFontSizePx,
  DYNAMIC_TYPE_DEFAULT_ROOT_PX,
  DYNAMIC_TYPE_MAX_ROOT_PX,
  DYNAMIC_TYPE_MAX_SCALE,
  shouldApplyRootFontSizeInline,
} from "@/lib/utils/dynamic-type";

describe("dynamic-type constants", () => {
  it("caps at 1.25× of 16px → 20px", () => {
    expect(DYNAMIC_TYPE_MAX_SCALE).toBe(1.25);
    expect(DYNAMIC_TYPE_DEFAULT_ROOT_PX).toBe(16);
    expect(DYNAMIC_TYPE_MAX_ROOT_PX).toBe(20);
  });
});

describe("clampRootFontSizePx", () => {
  it("leaves sizes at or under 20px unchanged", () => {
    expect(clampRootFontSizePx(16)).toBe(16);
    expect(clampRootFontSizePx(17)).toBe(17);
    expect(clampRootFontSizePx(20)).toBe(20);
  });

  it("clamps sizes above 20px to 20", () => {
    expect(clampRootFontSizePx(21)).toBe(20);
    expect(clampRootFontSizePx(28)).toBe(20);
    expect(clampRootFontSizePx(100)).toBe(20);
  });

  it("falls back to 16 for invalid input", () => {
    expect(clampRootFontSizePx(Number.NaN)).toBe(16);
    expect(clampRootFontSizePx(0)).toBe(16);
    expect(clampRootFontSizePx(-4)).toBe(16);
  });
});

describe("shouldApplyRootFontSizeInline", () => {
  it("is true only when over cap", () => {
    expect(shouldApplyRootFontSizeInline(16)).toBe(false);
    expect(shouldApplyRootFontSizeInline(20)).toBe(false);
    expect(shouldApplyRootFontSizeInline(20.1)).toBe(true);
  });
});

describe("applyDynamicTypeRootCap", () => {
  it("sets inline 20px when computed size is over cap", () => {
    const el = document.createElement("div");
    el.style.fontSize = "28px";
    document.body.appendChild(el);
    // Stub getComputedStyle for this element
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((target: Element) => {
      if (target === el) {
        return { fontSize: "28px" } as CSSStyleDeclaration;
      }
      return original(target);
    }) as typeof getComputedStyle;

    applyDynamicTypeRootCap(el);
    expect(el.style.fontSize).toBe("20px");

    globalThis.getComputedStyle = original;
    el.remove();
  });

  it("clears inline size when at or under cap", () => {
    const el = document.createElement("div");
    el.style.fontSize = "20px";
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((target: Element) => {
      if (target === el) {
        return { fontSize: "17px" } as CSSStyleDeclaration;
      }
      return original(target);
    }) as typeof getComputedStyle;

    applyDynamicTypeRootCap(el);
    expect(el.style.fontSize).toBe("");

    globalThis.getComputedStyle = original;
  });
});
