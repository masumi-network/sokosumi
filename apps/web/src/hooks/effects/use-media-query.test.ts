import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REDUCED_MOTION_MEDIA_QUERY,
  useMediaQuery,
  usePrefersReducedMotion,
} from "./use-media-query";

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  setMatches(next: boolean): void;
}

function stubMatchMedia(
  initial: Record<string, boolean>,
  options?: { legacyOnly?: boolean },
) {
  const lists = new Map<string, MockMediaQueryList>();

  function getList(query: string): MockMediaQueryList {
    const existing = lists.get(query);
    if (existing) return existing;

    const listeners = new Set<() => void>();
    const mql: MockMediaQueryList = {
      matches: initial[query] ?? false,
      media: query,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.delete(listener);
      }),
      addListener: vi.fn((listener: () => void) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener: () => void) => {
        listeners.delete(listener);
      }),
      setMatches(next: boolean) {
        mql.matches = next;
        for (const listener of listeners) {
          listener();
        }
      },
    };

    if (options?.legacyOnly) {
      // Simulate Safari < 14 MediaQueryList without addEventListener.
      (mql as { addEventListener?: unknown }).addEventListener = undefined;
      (mql as { removeEventListener?: unknown }).removeEventListener =
        undefined;
    }

    lists.set(query, mql);
    return mql;
  }

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => getList(query)),
  );

  return { getList };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the initial media query state on the client", () => {
    stubMatchMedia({ "(min-width: 64rem)": true });

    const { result } = renderHook(() => useMediaQuery("(min-width: 64rem)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes and cleans up on unmount", () => {
    const { getList } = stubMatchMedia({ "(min-width: 64rem)": false });

    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 64rem)"),
    );
    expect(result.current).toBe(false);

    const mql = getList("(min-width: 64rem)");
    act(() => {
      mql.setMatches(true);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("falls back to addListener and removeListener when addEventListener is missing", () => {
    const { getList } = stubMatchMedia(
      { "(min-width: 768px)": false },
      { legacyOnly: true },
    );

    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 768px)"),
    );
    expect(result.current).toBe(false);

    const mql = getList("(min-width: 768px)");
    expect(mql.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      mql.setMatches(true);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(mql.removeListener).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes when the query changes", () => {
    const { getList } = stubMatchMedia({
      "(min-width: 40rem)": true,
      "(min-width: 64rem)": false,
    });

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: "(min-width: 40rem)" } },
    );
    expect(result.current).toBe(true);

    rerender({ query: "(min-width: 64rem)" });
    expect(result.current).toBe(false);
    expect(
      getList("(min-width: 40rem)").removeEventListener,
    ).toHaveBeenCalled();

    act(() => {
      getList("(min-width: 64rem)").setMatches(true);
    });
    expect(result.current).toBe(true);
  });

  it("returns the fallback when window.matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);

    const { result } = renderHook(() => useMediaQuery("(min-width: 64rem)"));
    expect(result.current).toBe(false);
  });

  it("preserves an explicit undefined server snapshot during SSR", () => {
    function Probe({ explicitUndefined }: { explicitUndefined?: boolean }) {
      const value = explicitUndefined
        ? useMediaQuery("(max-width: 767px)", undefined)
        : useMediaQuery("(max-width: 767px)");
      return createElement("span", null, String(value));
    }

    expect(
      renderToString(createElement(Probe, { explicitUndefined: true })),
    ).toBe("<span>undefined</span>");
    expect(renderToString(createElement(Probe))).toBe("<span>false</span>");
  });
});

describe("usePrefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tracks prefers-reduced-motion live", () => {
    const { getList } = stubMatchMedia({ [REDUCED_MOTION_MEDIA_QUERY]: false });

    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      getList(REDUCED_MOTION_MEDIA_QUERY).setMatches(true);
    });
    expect(result.current).toBe(true);
  });
});
