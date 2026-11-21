import { act, render, renderHook } from "@testing-library/react";
import { Activity, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "./use-interval";

describe("useInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ticks repeatedly at the given delay", () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, 1_000));

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("pauses when delay is null and resumes when given a delay again", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ delayMs }: { delayMs: number | null }) =>
        useInterval(callback, delayMs),
      { initialProps: { delayMs: null as number | null } },
    );

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(callback).not.toHaveBeenCalled();

    rerender({ delayMs: 500 });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    rerender({ delayMs: null });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useInterval(callback, 500));

    unmount();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses the latest callback without resetting the interval", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ callback }: { callback: () => void }) => useInterval(callback, 1_000),
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

  it("runs immediately on start and resume when immediate is true", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ delayMs }: { delayMs: number | null }) =>
        useInterval(callback, delayMs, { immediate: true }),
      { initialProps: { delayMs: 1_000 as number | null } },
    );

    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    rerender({ delayMs: null });
    rerender({ delayMs: 1_000 });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("fires immediate again when returning from a hidden React Activity", () => {
    const callback = vi.fn();
    function Probe() {
      useInterval(callback, 1_000, { immediate: true });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(Probe),
      }),
    );
    expect(callback).toHaveBeenCalledTimes(1);

    rerender(
      createElement(Activity, {
        mode: "hidden",
        children: createElement(Probe),
      }),
    );
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    rerender(
      createElement(Activity, {
        mode: "visible",
        children: createElement(Probe),
      }),
    );
    expect(callback).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });
});
