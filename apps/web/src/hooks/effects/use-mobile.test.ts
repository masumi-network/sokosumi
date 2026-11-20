import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_BREAKPOINT, useIsMobile, useIsMobileMedia } from "./use-mobile";

function evaluateWidthQuery(query: string, viewportWidth: number): boolean {
  const negated = query.startsWith("not all and ");
  const clause = negated ? query.slice("not all and ".length) : query;
  const maxMatch = /^\(max-width:\s*(\d+(?:\.\d+)?)px\)$/.exec(clause);
  if (maxMatch) {
    const result = viewportWidth <= Number(maxMatch[1]);
    return negated ? !result : result;
  }
  const minMatch = /^\(min-width:\s*(\d+(?:\.\d+)?)px\)$/.exec(clause);
  if (minMatch) {
    const result = viewportWidth >= Number(minMatch[1]);
    return negated ? !result : result;
  }
  throw new Error(`Unsupported test media query: ${query}`);
}

function mockMatchMedia(matches: boolean, options?: { legacyOnly?: boolean }) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: `not all and (min-width: ${MOBILE_BREAKPOINT}px)`,
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

  it("treats fractional widths between 767 and 768 (e.g. 767.2px at 125% zoom) as mobile", () => {
    let width = 767.2;
    const listeners = new Set<() => void>();
    const matchMediaMock = vi.fn((query: string) => ({
      get matches() {
        return evaluateWidthQuery(query, width);
      },
      media: query,
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
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);

    const { result } = renderHook(() => useIsMobileMedia());
    expect(result.current).toBe(true);
    expect(matchMediaMock).toHaveBeenCalledWith(
      `not all and (min-width: ${MOBILE_BREAKPOINT}px)`,
    );

    width = 768;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe(false);
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
