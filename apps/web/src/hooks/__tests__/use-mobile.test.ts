import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_BREAKPOINT,
  useIsMobile,
  useIsMobileMedia,
} from "../use-mobile";

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql),
  });

  return mql;
}

describe("useIsMobileMedia", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  it("is undefined on the first render, then resolves from the media query", () => {
    mockMatchMedia(true);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT - 1,
    });

    const values: Array<boolean | undefined> = [];
    const { result } = renderHook(() => {
      const value = useIsMobileMedia();
      values.push(value);
      return value;
    });

    expect(values[0]).toBeUndefined();
    expect(result.current).toBe(true);
  });

  it("resolves to false at the desktop breakpoint after mount", () => {
    mockMatchMedia(false);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT,
    });

    const { result } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(false);
  });
});

describe("useIsMobile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coerces the first unresolved render to false", () => {
    mockMatchMedia(true);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT - 1,
    });

    const values: boolean[] = [];
    const { result } = renderHook(() => {
      const value = useIsMobile();
      values.push(value);
      return value;
    });

    expect(values[0]).toBe(false);
    expect(result.current).toBe(true);
  });
});
