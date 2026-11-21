import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPrefetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: routerPrefetchMock }),
}));

import {
  ACTIVE_WINDOW_MS,
  useWarmLikelyPages,
  WARM_INTERVAL_MS,
} from "./use-warm-likely-pages";

function storeVisits(counts: Record<string, number>) {
  window.localStorage.setItem(
    "sokosumi:likely-pages:v1",
    JSON.stringify(counts),
  );
}

describe("useWarmLikelyPages", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubGlobal("requestIdleCallback", undefined);
    routerPrefetchMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("warms likely pages on the initial timeout and interval, and cleans up on unmount", () => {
    storeVisits({ "/tasks": 5, "/projects": 3 });
    const { unmount } = renderHook(() =>
      useWarmLikelyPages((href) => `${href}?projectId=p1`),
    );

    expect(routerPrefetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(routerPrefetchMock).toHaveBeenCalledWith(
      "/tasks?projectId=p1",
      expect.anything(),
    );
    expect(routerPrefetchMock).toHaveBeenCalledWith(
      "/projects?projectId=p1",
      expect.anything(),
    );

    const callsAfterFirst = routerPrefetchMock.mock.calls.length;
    unmount();

    act(() => {
      vi.advanceTimersByTime(WARM_INTERVAL_MS * 3);
    });
    expect(routerPrefetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("pauses warming after the active window until activity resumes", () => {
    storeVisits({ "/tasks": 4 });
    renderHook(() => useWarmLikelyPages((href) => href));

    act(() => {
      vi.advanceTimersByTime(ACTIVE_WINDOW_MS + WARM_INTERVAL_MS);
    });
    const callsWhileIdle = routerPrefetchMock.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(WARM_INTERVAL_MS);
    });
    expect(routerPrefetchMock.mock.calls.length).toBe(callsWhileIdle);

    act(() => {
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(WARM_INTERVAL_MS);
    });
    expect(routerPrefetchMock.mock.calls.length).toBeGreaterThan(
      callsWhileIdle,
    );
  });
});
