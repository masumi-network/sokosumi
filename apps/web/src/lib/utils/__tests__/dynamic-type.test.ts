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
  it("sets inline 20px when natural computed size is over cap", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const original = globalThis.getComputedStyle;
    try {
      // After clear, measure natural size (stub always reports over-cap).
      globalThis.getComputedStyle = ((target: Element) => {
        if (target === el) {
          return { fontSize: "28px" } as CSSStyleDeclaration;
        }
        return original(target);
      }) as typeof getComputedStyle;

      applyDynamicTypeRootCap(el);
      expect(el.style.fontSize).toBe("20px");
    } finally {
      globalThis.getComputedStyle = original;
      el.remove();
    }
  });

  it("leaves inline empty when natural size is at or under cap", () => {
    const el = document.createElement("div");
    el.style.fontSize = "20px";
    const original = globalThis.getComputedStyle;
    try {
      globalThis.getComputedStyle = ((target: Element) => {
        if (target === el) {
          return { fontSize: "17px" } as CSSStyleDeclaration;
        }
        return original(target);
      }) as typeof getComputedStyle;

      applyDynamicTypeRootCap(el);
      expect(el.style.fontSize).toBe("");
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it("re-applies cap on re-run when prior inline 20px masked larger natural size", () => {
    const el = document.createElement("div");
    // Simulate prior successful cap still on the element.
    el.style.fontSize = "20px";
    document.body.appendChild(el);
    const original = globalThis.getComputedStyle;
    try {
      // Return natural over-cap only after clear (style empty); if stub saw 20px
      // without clear, old bug would drop the cap.
      globalThis.getComputedStyle = ((target: Element) => {
        if (target === el) {
          const inline = (target as HTMLElement).style.fontSize;
          if (inline === "" || inline == null) {
            return { fontSize: "28px" } as CSSStyleDeclaration;
          }
          return { fontSize: inline } as CSSStyleDeclaration;
        }
        return original(target);
      }) as typeof getComputedStyle;

      applyDynamicTypeRootCap(el);
      expect(el.style.fontSize).toBe("20px");
    } finally {
      globalThis.getComputedStyle = original;
      el.remove();
    }
  });

  it("leaves root uncapped when measurement throws", () => {
    const el = document.createElement("div");
    el.style.fontSize = "20px";
    const original = globalThis.getComputedStyle;
    try {
      globalThis.getComputedStyle = (() => {
        throw new Error("computed style unavailable");
      }) as typeof getComputedStyle;

      expect(() => applyDynamicTypeRootCap(el)).not.toThrow();
      expect(el.style.fontSize).toBe("");
    } finally {
      globalThis.getComputedStyle = original;
    }
  });
});
