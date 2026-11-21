import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prefetchMock } = vi.hoisted(() => ({
  prefetchMock: vi.fn(),
}));
const router = { prefetch: prefetchMock };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import {
  ACTIVE_WINDOW_MS,
  useWarmLikelyPages,
  WARM_INTERVAL_MS,
} from "./use-warm-likely-pages";

describe("useWarmLikelyPages", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubGlobal("requestIdleCallback", undefined);
    prefetchMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warms likely pages on idle, repeats on interval, and stops after unmount", () => {
    window.localStorage.setItem(
      "sokosumi:likely-pages:v1",
      JSON.stringify({ "/tasks": 4, "/projects": 2 }),
    );

    const { unmount } = renderHook(() =>
      useWarmLikelyPages((href) => `${href}?projectId=p1`),
    );

    act(() => vi.advanceTimersByTime(2_000));
    expect(prefetchMock.mock.calls.map(([href]) => href)).toEqual([
      "/tasks?projectId=p1",
      "/projects?projectId=p1",
    ]);

    prefetchMock.mockReset();
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));
    expect(prefetchMock.mock.calls.map(([href]) => href)).toEqual([
      "/tasks?projectId=p1",
      "/projects?projectId=p1",
    ]);

    prefetchMock.mockReset();
    unmount();
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS * 2));
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it("pauses after inactivity and resumes on user input", () => {
    window.localStorage.setItem(
      "sokosumi:likely-pages:v1",
      JSON.stringify({ "/tasks": 1 }),
    );

    renderHook(() => useWarmLikelyPages((href) => href));

    act(() => vi.advanceTimersByTime(ACTIVE_WINDOW_MS + WARM_INTERVAL_MS));
    prefetchMock.mockReset();
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));
    expect(prefetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("keydown"));
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));
    expect(prefetchMock.mock.calls.map(([href]) => href)).toEqual(["/tasks"]);
  });
});
