import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_DELAYS_MS, usePolling } from "./polling.ts";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Runs the timers `ms` ahead and lets the refresh promises settle. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePolling", () => {
  it("waits 3s, then 5s, then 10s between checks", async () => {
    const refresh = vi.fn(async () => true);
    renderHook(() => usePolling(refresh, true));
    expect(POLL_DELAYS_MS).toEqual([3000, 5000, 10000]);

    await advance(2999);
    expect(refresh).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(4999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(9999);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(3);
    // It stays at the longest delay.
    await advance(10000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("keeps its backoff when the view re-renders with a new refresh function", async () => {
    const refresh = vi.fn(async () => true);
    const { rerender } = renderHook(({ run }) => usePolling(run, true), {
      initialProps: { run: () => refresh() },
    });
    await advance(3000);
    rerender({ run: () => refresh() });
    await advance(3000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops when the Job finishes", async () => {
    const refresh = vi.fn(async () => true);
    const { rerender } = renderHook(
      ({ active }) => usePolling(refresh, active),
      {
        initialProps: { active: true },
      },
    );
    await advance(3000);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not poll a finished Job or without a refresh", async () => {
    const refresh = vi.fn(async () => true);
    renderHook(() => usePolling(refresh, false));
    renderHook(() => usePolling(undefined, true));
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops while hidden and starts again at 3s when shown", async () => {
    const refresh = vi.fn(async () => true);
    renderHook(() => usePolling(refresh, true));
    await advance(3000);
    await advance(5000);
    expect(refresh).toHaveBeenCalledTimes(2);

    act(() => setVisibility("hidden"));
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    act(() => setVisibility("visible"));
    await advance(2999);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not start while the view opens hidden", async () => {
    visibility = "hidden";
    const refresh = vi.fn(async () => true);
    renderHook(() => usePolling(refresh, true));
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not schedule a second check when shown during a check", async () => {
    let finish: (ok: boolean) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => usePolling(refresh, true));
    await advance(3000);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await act(async () => finish(true));
    await advance(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reports a failed check and keeps backing off", async () => {
    const refresh = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { result } = renderHook(() => usePolling(refresh, true));
    expect(result.current.failed).toBe(false);

    await advance(3000);
    expect(result.current.failed).toBe(true);
    await advance(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(false);
  });

  it("stops when unmounted", async () => {
    const refresh = vi.fn(async () => true);
    const { unmount } = renderHook(() => usePolling(refresh, true));
    unmount();
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
