import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDynamicTypeRootCap } from "./use-dynamic-type-root-cap";

function stubRootFontSize(fontSize: string) {
  const realGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
  return vi
    .spyOn(globalThis, "getComputedStyle")
    .mockImplementation((element, pseudo) => {
      if (element === document.documentElement) {
        return { fontSize } as CSSStyleDeclaration;
      }
      return realGetComputedStyle(element, pseudo);
    });
}

describe("useDynamicTypeRootCap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.fontSize = "";
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("caps documentElement fontSize on mount when natural size exceeds 20px", () => {
    stubRootFontSize("24px");

    renderHook(() => useDynamicTypeRootCap());

    expect(document.documentElement.style.fontSize).toBe("20px");
  });

  it("leaves fontSize unset when natural size is within 20px", () => {
    stubRootFontSize("16px");

    renderHook(() => useDynamicTypeRootCap());

    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("re-applies on pageshow and visible visibilitychange, and stops after unmount", () => {
    let naturalSize = "16px";
    const realGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        if (element === document.documentElement) {
          return { fontSize: naturalSize } as CSSStyleDeclaration;
        }
        return realGetComputedStyle(element, pseudo);
      },
    );

    const { unmount } = renderHook(() => useDynamicTypeRootCap());
    expect(document.documentElement.style.fontSize).toBe("");

    naturalSize = "26px";
    window.dispatchEvent(new Event("pageshow"));
    expect(document.documentElement.style.fontSize).toBe("20px");

    naturalSize = "18px";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.style.fontSize).toBe("20px");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.style.fontSize).toBe("");

    unmount();

    naturalSize = "28px";
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.style.fontSize).toBe("");
  });
});
