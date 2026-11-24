import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TASKS_BOARD_REFRESH_DEBOUNCE_MS,
  TASKS_BOARD_REFRESH_MAX_WAIT_MS,
} from "@/app/tasks/constants";
import {
  markTaskArchived,
  settleTaskArchive,
} from "@/app/tasks/utils/archived-task-ids";
import {
  CONTROL_IN_USE_CHECK_MS,
  useRefreshPrefetchedPage,
} from "./use-refresh-prefetched-page";
import { useRefreshWhenShown } from "./use-refresh-when-shown";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/refresh-page-action", () => ({
  refreshPage: vi.fn(async () => true),
}));

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

  it("cancels a pending debounced refresh on unmount", () => {
    const refresh = vi.fn();
    const { result, unmount } = renderHook(() => useRefreshWhenShown(refresh));
    act(() => {
      result.current();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_MAX_WAIT_MS);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when a pending archive settles, unless an arrival refresh is already pending", () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshWhenShown(refresh));

    markTaskArchived("archive-settle-1");
    act(() => {
      settleTaskArchive("archive-settle-1");
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    // Simulate a hovered button so useRefreshPrefetchedPage schedules a pending arrival refresh.
    const button = document.createElement("button");
    document.body.appendChild(button);
    const originalMatches = Element.prototype.matches;
    const originalQsa = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation((selector) =>
      selector.includes(":hover")
        ? ([button] as unknown as NodeListOf<Element>)
        : originalQsa(selector),
    );
    try {
      const arrival = renderHook(() => useRefreshPrefetchedPage(true));
      markTaskArchived("archive-settle-2");
      act(() => {
        settleTaskArchive("archive-settle-2");
        vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS);
      });
      // Advance past debounce without letting the arrival refresh start first?
      // Actually arrival starts at MAX_REFRESH_WAIT_MS (3000ms) while debounce is 2000ms.
      act(() => {
        vi.advanceTimersByTime(TASKS_BOARD_REFRESH_DEBOUNCE_MS);
      });
      expect(refresh).not.toHaveBeenCalled();
      arrival.unmount();
    } finally {
      Element.prototype.matches = originalMatches;
      vi.restoreAllMocks();
      button.remove();
    }
  });
});
