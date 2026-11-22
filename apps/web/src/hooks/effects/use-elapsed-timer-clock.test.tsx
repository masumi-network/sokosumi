import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElapsedTimerClock } from "./use-elapsed-timer-clock";

describe("useElapsedTimerClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every 1000ms and clears its interval on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const captured = { now: 0 };
    function Probe() {
      captured.now = useElapsedTimerClock();
      return null;
    }

    const { unmount } = render(<Probe />);
    const start = captured.now;

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(captured.now - start).toBe(3000);

    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(captured.now - start).toBe(3000);
  });
});
