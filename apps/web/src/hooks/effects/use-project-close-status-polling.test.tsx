import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectCloseStatusPolling } from "./use-project-close-status-polling";

describe("useProjectCloseStatusPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes inside startTransition every 5s only while CLOSING and not pending", () => {
    const router = { refresh: vi.fn() };
    const startTransition = vi.fn((fn: () => void) => fn());

    const { rerender, unmount } = renderHook(
      ({
        state,
        isPending,
        nextRouter,
      }: {
        state: "CLOSING" | "CLOSED" | "CLOSE_FAILED";
        isPending: boolean;
        nextRouter: { refresh: () => void };
      }) =>
        useProjectCloseStatusPolling(
          state,
          isPending,
          startTransition,
          nextRouter,
        ),
      {
        initialProps: {
          state: "CLOSING" as "CLOSING" | "CLOSED" | "CLOSE_FAILED",
          isPending: false,
          nextRouter: router,
        },
      },
    );

    vi.advanceTimersByTime(4_999);
    expect(router.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(startTransition).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    rerender({ state: "CLOSING", isPending: true, nextRouter: router });
    vi.advanceTimersByTime(10_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    rerender({ state: "CLOSED", isPending: false, nextRouter: router });
    vi.advanceTimersByTime(10_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    const nextRouter = { refresh: vi.fn() };
    rerender({ state: "CLOSING", isPending: false, nextRouter });
    vi.advanceTimersByTime(5_000);
    expect(nextRouter.refresh).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(10_000);
    expect(nextRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
