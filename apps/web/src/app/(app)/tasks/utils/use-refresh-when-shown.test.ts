import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TASKS_BOARD_REFRESH_DEBOUNCE_MS,
  TASKS_BOARD_REFRESH_MAX_WAIT_MS,
} from "@/app/tasks/constants";
import { useRefreshWhenShown } from "./use-refresh-when-shown";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useRefreshWhenShown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("refreshes once for a burst of events", () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useRefreshWhenShown(refresh));
    act(() => {
      for (let i = 0; i < 5; i++) result.current();
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still refreshes during a steady stream of events", () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useRefreshWhenShown(refresh));
    act(() => {
      for (let t = 0; t <= TASKS_BOARD_REFRESH_MAX_WAIT_MS; t += 1_000) {
        result.current();
        vi.advanceTimersByTime(1_000);
      }
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("waits while hidden and refreshes once when shown again", () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useRefreshWhenShown(refresh));
    act(() => setVisibility("hidden"));
    act(() => {
      result.current();
      result.current();
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_MAX_WAIT_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      setVisibility("visible");
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on showing when nothing changed", () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshWhenShown(refresh));
    act(() => {
      setVisibility("hidden");
      setVisibility("visible");
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_MAX_WAIT_MS);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
