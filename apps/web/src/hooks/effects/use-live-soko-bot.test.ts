import { SokoBotStatus } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishFailedMock } = vi.hoisted(() => ({
  publishFailedMock: vi.fn(),
}));

vi.mock("@/hooks/effects/use-failed-soko-bot-id-publisher", () => ({
  useFailedSokoBotIdPublisher: (...args: unknown[]) =>
    publishFailedMock(...args),
}));

import { useLiveSokoBot } from "./use-live-soko-bot";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useLiveSokoBot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls activity on mount and interval, publishing failed bot id on ERROR", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          activity: {
            status: SokoBotStatus.ERROR,
            lastActivityAt: "2026-11-21T09:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          activity: {
            status: SokoBotStatus.IDLE,
            lastActivityAt: "2026-11-21T09:05:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const initial = {
      id: "bot-1",
      status: SokoBotStatus.IDLE,
      lastActivityAt: null as Date | null,
    };
    const { result, unmount } = renderHook(() => useLiveSokoBot(initial));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe(SokoBotStatus.ERROR);
    expect(publishFailedMock).toHaveBeenLastCalledWith("bot-1");

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe(SokoBotStatus.IDLE);
    expect(publishFailedMock).toHaveBeenLastCalledWith(null);

    unmount();
    vi.advanceTimersByTime(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips polling while hidden and asks when shown again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        activity: { status: SokoBotStatus.IDLE },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setVisibility("hidden");

    const initial = {
      id: "bot-1",
      status: SokoBotStatus.IDLE,
      lastActivityAt: null as Date | null,
    };
    renderHook(() => useLiveSokoBot(initial));

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
