import { SokoBotStatus } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveSokoBotPoll } from "./use-live-soko-bot-poll";

describe("useLiveSokoBotPoll", () => {
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

  it("polls immediately, on interval, and on visibilitychange, and stops on unmount", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          activity: {
            status: SokoBotStatus.RUNNING,
            lastActivityAt: "2026-11-21T10:00:00.000Z",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          activity: {
            status: SokoBotStatus.IDLE,
            lastActivityAt: "2026-11-21T10:01:00.000Z",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const botA = { id: "bot-1" };
    const { result, rerender, unmount } = renderHook(
      ({ bot }) => useLiveSokoBotPoll(bot),
      { initialProps: { bot: botA } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current?.status).toBe(SokoBotStatus.RUNNING);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current?.status).toBe(SokoBotStatus.IDLE);

    // Discards overlay when server-rendered bot identity changes.
    rerender({ bot: { id: "bot-1" } });
    expect(result.current).toBeNull();

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
