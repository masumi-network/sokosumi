import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoutePoller } from "./use-route-poller";

describe("useRoutePoller", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("refreshes while visible, skips hidden tabs and pending transitions, stops at times, and cleans up on unmount", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    const router = { refresh: vi.fn() };
    const startTransition = vi.fn((fn: () => void) => {
      fn();
    });

    function Probe({
      isPending,
      everyMs,
      times,
    }: {
      isPending: boolean;
      everyMs: number;
      times: number;
    }) {
      const asked = useRef(0);
      useRoutePoller({
        asked,
        everyMs,
        isPending,
        router,
        startTransition,
        times,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe isPending={false} everyMs={1000} times={2} />,
    );

    vi.advanceTimersByTime(1000);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // Hidden tab skips ticks without incrementing asked.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    vi.advanceTimersByTime(2000);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // Pending transition pauses interval.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    rerender(<Probe isPending={true} everyMs={1000} times={2} />);
    vi.advanceTimersByTime(2000);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // Resuming reaches times=2 and then stops polling.
    rerender(<Probe isPending={false} everyMs={1000} times={2} />);
    vi.advanceTimersByTime(5000);
    expect(router.refresh).toHaveBeenCalledTimes(2);

    unmount();
  });
});
