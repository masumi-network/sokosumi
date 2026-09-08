import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomMessagePolling } from "./use-room-message-polling";

describe("useRoomMessagePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("coalesces timer, focus, visibility, and explicit refresh until completion", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRoomMessagePolling("room-1", refresh),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await result.current();
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retries a rejected refresh after the normal delay", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    renderHook(() => useRoomMessagePolling("room-1", refresh));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden polls and refreshes once when visibility returns", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRoomMessagePolling("room-1", refresh),
    );
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await result.current();
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(refresh).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("invalidates a previous visit without blocking the new room", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn<(isCurrent: () => boolean) => Promise<void>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { rerender, unmount } = renderHook(
      ({ roomId }) => useRoomMessagePolling(roomId, refresh),
      { initialProps: { roomId: "room-1" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    const previousIsCurrent = refresh.mock.calls[0][0];
    expect(previousIsCurrent()).toBe(true);
    rerender({ roomId: "room-2" });
    rerender({ roomId: "room-1" });
    expect(previousIsCurrent()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve());
    unmount();
    expect(refresh.mock.calls[1][0]()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without resetting the polling delay", async () => {
    const initial = vi.fn().mockResolvedValue(undefined);
    const latest = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ refresh }) => useRoomMessagePolling("room-1", refresh),
      { initialProps: { refresh: initial } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    rerender({ refresh: latest });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(initial).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
