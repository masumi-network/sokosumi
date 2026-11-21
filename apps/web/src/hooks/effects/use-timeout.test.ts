import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "./use-timeout";

describe("useTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires once after the given delay", () => {
    const callback = vi.fn();
    renderHook(() => useTimeout(callback, 500));

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("pauses when delay is null and cancels a pending timeout", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ delayMs }: { delayMs: number | null }) =>
        useTimeout(callback, delayMs),
      { initialProps: { delayMs: null as number | null } },
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).not.toHaveBeenCalled();

    rerender({ delayMs: 500 });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    rerender({ delayMs: null });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("clears the timeout on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useTimeout(callback, 500));

    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses the latest callback without resetting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ callback }: { callback: () => void }) => useTimeout(callback, 1_000),
      { initialProps: { callback: first } },
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    rerender({ callback: second });

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("restarts the timer when resetKey changes even with the same delay", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useTimeout(callback, 300, key),
      { initialProps: { key: "a" } },
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(callback).not.toHaveBeenCalled();

    rerender({ key: "b" });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
