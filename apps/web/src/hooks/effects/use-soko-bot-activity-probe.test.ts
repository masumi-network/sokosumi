import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSokoBotActivityProbe } from "./use-soko-bot-activity-probe";

describe("useSokoBotActivityProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes when signature changes or a turn is active, skips unchanged idle ticks, and stops on unmount", async () => {
    const activities = [
      { status: "IDLE", activeTurnId: null, lastTurnAt: "t0" },
      { status: "IDLE", activeTurnId: null, lastTurnAt: "t0" },
      { status: "RUNNING", activeTurnId: "turn-1", lastTurnAt: "t1" },
    ];
    let index = 0;
    const fetchMock = vi.fn(async () => {
      const activity = activities[Math.min(index, activities.length - 1)];
      index += 1;
      return { ok: true, json: async () => ({ activity }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const onRefresh = vi.fn(async () => {});
    const { unmount } = renderHook(() =>
      useSokoBotActivityProbe("/api/personal-assistant/activity", onRefresh),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Same idle signature: probe runs, refresh skipped.
    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Active turn: refreshes.
    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
