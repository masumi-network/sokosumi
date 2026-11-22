import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OUTBOUND_SENT_TICK_MS } from "@/app/chat/utils/outbound-room-message";
import { useOutboundSentTickFade } from "./use-outbound-sent-tick-fade";

function FadeProbe({
  showSentTick,
  createdAt,
}: {
  showSentTick: boolean;
  createdAt: Date | string;
}) {
  const fading = useOutboundSentTickFade(showSentTick, createdAt);
  return <span data-testid="fading">{fading ? "yes" : "no"}</span>;
}

describe("useOutboundSentTickFade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts fading after half OUTBOUND_SENT_TICK_MS and resets on a new Date reference identity", () => {
    const firstDate = new Date("2026-11-20T12:00:00.000Z");
    const { rerender, unmount } = render(
      <FadeProbe showSentTick={true} createdAt={firstDate} />,
    );
    expect(screen.getByTestId("fading")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(OUTBOUND_SENT_TICK_MS / 2 - 1);
    });
    expect(screen.getByTestId("fading")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("fading")).toHaveTextContent("yes");

    // A fresh Date object with the same timestamp restarts the fade timer (reference identity parity).
    const sameTimeNewRef = new Date(firstDate.getTime());
    rerender(<FadeProbe showSentTick={true} createdAt={sameTimeNewRef} />);
    expect(screen.getByTestId("fading")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(OUTBOUND_SENT_TICK_MS / 2);
    });
    expect(screen.getByTestId("fading")).toHaveTextContent("yes");

    rerender(<FadeProbe showSentTick={false} createdAt={sameTimeNewRef} />);
    expect(screen.getByTestId("fading")).toHaveTextContent("no");

    unmount();
  });

  it("clears the timer on StrictMode replay, Activity hide, and unmount, and restarts on reveal", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const createdAt = "2026-11-20T12:00:00.000Z";

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <FadeProbe showSentTick={true} createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <FadeProbe showSentTick={true} createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(OUTBOUND_SENT_TICK_MS);
    });
    expect(screen.getByTestId("fading")).toHaveTextContent("no");

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <FadeProbe showSentTick={true} createdAt={createdAt} />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      vi.advanceTimersByTime(OUTBOUND_SENT_TICK_MS / 2);
    });
    expect(screen.getByTestId("fading")).toHaveTextContent("yes");

    unmount();
  });
});
