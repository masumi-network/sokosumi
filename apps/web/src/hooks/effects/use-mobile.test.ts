import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_BREAKPOINT, useIsMobile, useIsMobileMedia } from "./use-mobile";

function mockMatchMedia(matches: boolean, options?: { legacyOnly?: boolean }) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    onchange: null,
    addEventListener: options?.legacyOnly
      ? undefined
      : vi.fn((_type: string, listener: () => void) => {
          listeners.add(listener);
        }),
    removeEventListener: options?.legacyOnly
      ? undefined
      : vi.fn((_type: string, listener: () => void) => {
          listeners.delete(listener);
        }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn((listener: () => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: () => void) => {
      listeners.delete(listener);
    }),
    dispatch(nextMatches?: boolean) {
      if (nextMatches !== undefined) {
        mql.matches = nextMatches;
      }
      for (const listener of listeners) {
        listener();
      }
    },
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );

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
      mql.dispatch(true);
    });
    expect(result.current).toBe(true);
  });

  it("stays undefined during SSR", () => {
    function Probe() {
      return createElement("span", null, String(useIsMobileMedia()));
    }

    expect(renderToString(createElement(Probe))).toBe("<span>undefined</span>");
  });

  it("supports legacy addListener-only MediaQueryList", () => {
    const mql = mockMatchMedia(false, { legacyOnly: true });

    const { result, unmount } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(false);
    expect(mql.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      mql.dispatch(true);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(mql.removeListener).toHaveBeenCalledTimes(1);
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
