import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_BREAKPOINT, useIsMobile, useIsMobileMedia } from "./use-mobile";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatch() {
      for (const listener of listeners) {
        listener();
      }
    },
  };

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

  it("reads the media query on the client", () => {
    mockMatchMedia(true);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT - 1,
    });

    const { result } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(true);
  });

  it("resolves to false at the desktop breakpoint", () => {
    mockMatchMedia(false);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT,
    });

    const { result } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(false);
  });

  it("updates when the media query changes", () => {
    const mql = mockMatchMedia(false);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT,
    });

    const { result } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(false);

    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT - 1,
    });
    act(() => {
      mql.dispatch();
    });
    expect(result.current).toBe(true);
  });
});

describe("useIsMobile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is true when the viewport is mobile", () => {
    mockMatchMedia(true);
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE_BREAKPOINT - 1,
    });

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
