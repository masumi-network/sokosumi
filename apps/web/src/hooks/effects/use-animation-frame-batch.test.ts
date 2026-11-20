import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnimationFrameBatch } from "./use-animation-frame-batch";

describe("useAnimationFrameBatch", () => {
  let nextFrameId = 1;
  let queuedFrames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    nextFrameId = 1;
    queuedFrames = new Map();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextFrameId++;
      queuedFrames.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      queuedFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushFrames() {
    const callbacks = [...queuedFrames.values()];
    queuedFrames.clear();
    for (const cb of callbacks) {
      cb(performance.now());
    }
  }

  it("batches multiple enqueued items into a single animation frame flush", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useAnimationFrameBatch<string>(onFlush),
    );

    act(() => {
      result.current("a");
      result.current("b");
      result.current("c");
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      flushFrames();
    });

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("uses the latest onFlush callback when the frame runs", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onFlush }) => useAnimationFrameBatch<number>(onFlush),
      { initialProps: { onFlush: first } },
    );

    act(() => {
      result.current(1);
    });

    rerender({ onFlush: second });

    act(() => {
      flushFrames();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith([1]);
  });

  it("cancels the pending animation frame and drops queued items on unmount", () => {
    const onFlush = vi.fn();
    let capturedCallback: FrameRequestCallback | null = null;
    vi.mocked(window.requestAnimationFrame).mockImplementation((cb) => {
      capturedCallback = cb;
      const id = nextFrameId++;
      queuedFrames.set(id, cb);
      return id;
    });

    const { result, unmount } = renderHook(() =>
      useAnimationFrameBatch<string>(onFlush),
    );

    act(() => {
      result.current("late");
    });

    unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(queuedFrames.size).toBe(0);

    // Even if a stale frame callback fires after unmount, it must be ignored.
    act(() => {
      capturedCallback?.(performance.now());
    });

    expect(onFlush).not.toHaveBeenCalled();
  });
});
