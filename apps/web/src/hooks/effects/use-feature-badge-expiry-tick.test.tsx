import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFeatureBadgeExpiryTick } from "@/hooks/effects/use-feature-badge-expiry-tick";

describe("useFeatureBadgeExpiryTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments the tick at nextEnd, skips Infinity, and cancels pending timers on change or unmount", () => {
    const start = Date.now();
    const { result, rerender, unmount } = renderHook(
      ({ nextEnd }: { nextEnd: number }) => useFeatureBadgeExpiryTick(nextEnd),
      { initialProps: { nextEnd: Number.POSITIVE_INFINITY } },
    );

    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(0);

    // Schedule at +5s, then replace with +2s before +5s fires.
    rerender({ nextEnd: start + 15_000 });
    rerender({ nextEnd: start + 12_000 });

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(1);

    // Schedule another expiry and unmount before it fires.
    rerender({ nextEnd: Date.now() + 3_000 });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(1);
  });
});
