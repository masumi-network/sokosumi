import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useScheduledTimeout,
  useScheduledTimeoutMap,
} from "./use-scheduled-timeout";

describe("useScheduledTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires once after the scheduled delay and clears pending state", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useScheduledTimeout());

    expect(result.current.isPending()).toBe(false);

    act(() => {
      result.current.schedule(callback, 200);
    });
    expect(result.current.isPending()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(callback).not.toHaveBeenCalled();
    expect(result.current.isPending()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.current.isPending()).toBe(false);
  });

  it("cancels synchronously and prevents the scheduled callback from firing", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useScheduledTimeout());

    act(() => {
      result.current.schedule(callback, 300);
    });
    expect(result.current.isPending()).toBe(true);

    result.current.cancel();
    expect(result.current.isPending()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("replaces an earlier pending timer synchronously when scheduled again", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useScheduledTimeout());

    act(() => {
      result.current.schedule(first, 200);
      vi.advanceTimersByTime(150);
      result.current.schedule(second, 200);
      vi.advanceTimersByTime(100);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("clears a pending timeout on unmount", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useScheduledTimeout());

    act(() => {
      result.current.schedule(callback, 200);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("keeps a stable handle identity across rerenders and works in StrictMode", () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(() => useScheduledTimeout(), {
      wrapper: StrictMode,
    });
    const firstHandle = result.current;

    rerender();
    expect(result.current).toBe(firstHandle);

    act(() => {
      result.current.schedule(callback, 100);
      vi.advanceTimersByTime(100);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("useScheduledTimeoutMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tracks independent keyed timeouts and clears each entry after firing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useScheduledTimeoutMap<string>());

    act(() => {
      result.current.schedule("a", first, 100);
      result.current.schedule("b", second, 250);
    });
    expect(result.current.has("a")).toBe(true);
    expect(result.current.has("b")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.has("a")).toBe(false);
    expect(result.current.has("b")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.has("b")).toBe(false);
  });

  it("replaces an existing key without disturbing other keys", () => {
    const oldA = vi.fn();
    const newA = vi.fn();
    const b = vi.fn();
    const { result } = renderHook(() => useScheduledTimeoutMap<string>());

    act(() => {
      result.current.schedule("a", oldA, 100);
      result.current.schedule("b", b, 150);
      vi.advanceTimersByTime(50);
      result.current.schedule("a", newA, 200);
      vi.advanceTimersByTime(100);
    });

    expect(oldA).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(newA).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(newA).toHaveBeenCalledTimes(1);
  });

  it("cancels one key or all keys synchronously and clears all on unmount", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const { result, unmount } = renderHook(() =>
      useScheduledTimeoutMap<string>(),
    );

    act(() => {
      result.current.schedule("a", a, 100);
      result.current.schedule("b", b, 100);
    });

    result.current.cancel("a");
    expect(result.current.has("a")).toBe(false);
    expect(result.current.has("b")).toBe(true);

    result.current.cancelAll();
    expect(result.current.has("b")).toBe(false);

    act(() => {
      result.current.schedule("c", c, 100);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });
});
