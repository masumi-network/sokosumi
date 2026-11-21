import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTaskActivityRowEnter } from "./use-task-activity-row-enter";

describe("useTaskActivityRowEnter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts false and flips to true on the next animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    const { result } = renderHook(() => useTaskActivityRowEnter());
    expect(result.current).toBe(false);
    expect(callbacks).toHaveLength(1);

    act(() => {
      callbacks[0]?.(16);
    });
    expect(result.current).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("cancels the pending animation frame on unmount", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    const { unmount } = renderHook(() => useTaskActivityRowEnter());
    unmount();

    expect(cancelSpy).toHaveBeenCalledWith(42);
  });
});
