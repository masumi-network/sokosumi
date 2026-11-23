import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotificationRowDeparture } from "./use-notification-row-departure";

describe("useNotificationRowDeparture", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onDeparted after 200ms when collapsed, cancels if uncollapsed mid-fold, and fires immediately under reduced motion", () => {
    vi.useFakeTimers();
    const onDeparted = vi.fn();

    function Probe({
      isCollapsed,
      notificationId,
      reduceMotion,
    }: {
      isCollapsed: boolean;
      notificationId: string;
      reduceMotion: boolean;
    }) {
      useNotificationRowDeparture(
        isCollapsed,
        notificationId,
        onDeparted,
        reduceMotion,
      );
      return null;
    }

    const { rerender, unmount } = render(
      <Probe isCollapsed={false} notificationId="n-1" reduceMotion={false} />,
    );
    expect(onDeparted).not.toHaveBeenCalled();

    // Start fold, then uncollapse before 200ms: pending hide must be cancelled.
    rerender(
      <Probe isCollapsed={true} notificationId="n-1" reduceMotion={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onDeparted).not.toHaveBeenCalled();

    rerender(
      <Probe isCollapsed={false} notificationId="n-1" reduceMotion={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDeparted).not.toHaveBeenCalled();

    // Full 200ms fold calls onDeparted with notificationId.
    rerender(
      <Probe isCollapsed={true} notificationId="n-1" reduceMotion={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDeparted).toHaveBeenCalledTimes(1);
    expect(onDeparted).toHaveBeenCalledWith("n-1");

    // Reduced motion departs immediately without waiting for timeout.
    rerender(
      <Probe isCollapsed={true} notificationId="n-2" reduceMotion={true} />,
    );
    expect(onDeparted).toHaveBeenCalledTimes(2);
    expect(onDeparted).toHaveBeenLastCalledWith("n-2");

    unmount();
  });
});
