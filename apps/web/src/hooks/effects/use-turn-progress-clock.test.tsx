import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTurnProgressClock } from "./use-turn-progress-clock";

describe("useTurnProgressClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle while startedAt is null, ticks once set, and clears on reset or unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const captured = { now: 0 };
    function Probe({ startedAt }: { startedAt: number | null }) {
      captured.now = useTurnProgressClock(startedAt);
      return null;
    }

    const { rerender, unmount } = render(<Probe startedAt={null} />);
    const start = captured.now;
    expect(setIntervalSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(captured.now).toBe(start);

    rerender(<Probe startedAt={Date.now()} />);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(captured.now - start).toBe(7000);

    rerender(<Probe startedAt={null} />);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    unmount();
  });
});
