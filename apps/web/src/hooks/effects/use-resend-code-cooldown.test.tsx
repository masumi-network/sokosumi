import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResendCodeCooldown } from "./use-resend-code-cooldown";

describe("useResendCodeCooldown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down from 30s to 0, stops the interval at 0, and restarts when sentAt updates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const captured = { left: -1 };
    function Probe({ sentAt }: { sentAt: number }) {
      captured.left = useResendCodeCooldown(sentAt);
      return null;
    }

    const t0 = Date.now();
    const { rerender, unmount } = render(<Probe sentAt={t0} />);
    expect(captured.left).toBe(30);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(captured.left).toBe(20);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(captured.left).toBe(0);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // A new send restarts the 30-second countdown.
    rerender(<Probe sentAt={Date.now()} />);
    expect(captured.left).toBe(30);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(captured.left).toBe(25);

    unmount();
  });
});
