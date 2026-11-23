import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OUTBOUND_PENDING_SPINNER_DELAY_MS } from "@/app/chat/utils/outbound-room-message";
import { useOutboundPendingSpinner } from "./use-outbound-pending-spinner";

function SpinnerProbe({
  outboundStatus,
  createdAt,
}: {
  outboundStatus: "pending" | "failed" | null;
  createdAt: Date | string;
}) {
  const show = useOutboundPendingSpinner(outboundStatus, createdAt);
  return <span data-testid="spinner">{show ? "yes" : "no"}</span>;
}

describe("useOutboundPendingSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing the spinner until OUTBOUND_PENDING_SPINNER_DELAY_MS and resets when status leaves pending", () => {
    const createdAt = new Date(10_000);
    const { rerender, unmount } = render(
      <SpinnerProbe outboundStatus="pending" createdAt={createdAt} />,
    );
    expect(screen.getByTestId("spinner")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(OUTBOUND_PENDING_SPINNER_DELAY_MS - 1);
    });
    expect(screen.getByTestId("spinner")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("spinner")).toHaveTextContent("yes");

    rerender(<SpinnerProbe outboundStatus={null} createdAt={createdAt} />);
    expect(screen.getByTestId("spinner")).toHaveTextContent("no");

    unmount();
  });

  it("shows immediately when already past the delay and cancels timers on StrictMode replay, Activity hide, and unmount", () => {
    const oldCreatedAt = new Date(
      10_000 - OUTBOUND_PENDING_SPINNER_DELAY_MS - 10,
    );
    const immediate = render(
      <SpinnerProbe outboundStatus="pending" createdAt={oldCreatedAt} />,
    );
    expect(screen.getByTestId("spinner")).toHaveTextContent("yes");
    immediate.unmount();

    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const createdAt = new Date(10_000);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <SpinnerProbe outboundStatus="pending" createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    // Hide before the delay expires: cancels the timer and stays "no".
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <SpinnerProbe outboundStatus="pending" createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(OUTBOUND_PENDING_SPINNER_DELAY_MS + 50);
    });
    expect(screen.getByTestId("spinner")).toHaveTextContent("no");

    // Reveal after the delay elapsed: immediately flips to "yes".
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <SpinnerProbe outboundStatus="pending" createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("spinner")).toHaveTextContent("yes");

    unmount();
  });
});
