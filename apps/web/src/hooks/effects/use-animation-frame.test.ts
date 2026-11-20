import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnimationFrame } from "./use-animation-frame";

describe("useAnimationFrame", () => {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    frameId = 0;
    frames.clear();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function advanceFrame(timestamp: number) {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of callbacks) callback(timestamp);
    });
  }

  it("delivers elapsed seconds between consecutive frames while active", () => {
    const onFrame = vi.fn();
    renderHook(() => useAnimationFrame(true, onFrame));

    advanceFrame(100);
    expect(onFrame).not.toHaveBeenCalled();

    advanceFrame(116);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]?.[0]).toBeCloseTo(0.016);

    advanceFrame(148);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.calls[1]?.[0]).toBeCloseTo(0.032);
  });

  it("stops scheduling when inactive and resets elapsed time on resume", () => {
    const onFrame = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useAnimationFrame(active, onFrame),
      { initialProps: { active: false } },
    );

    expect(frames.size).toBe(0);

    rerender({ active: true });
    expect(frames.size).toBe(1);
    advanceFrame(0);
    advanceFrame(100);
    expect(onFrame).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    expect(frames.size).toBe(0);

    rerender({ active: true });
    advanceFrame(5000);
    // First frame after resume re-anchors the clock rather than jumping 4.9s.
    expect(onFrame).toHaveBeenCalledTimes(1);
    advanceFrame(5020);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.calls[1]?.[0]).toBeCloseTo(0.02);

    unmount();
    expect(frames.size).toBe(0);
  });
});
