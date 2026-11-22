import { render } from "@testing-library/react";
import { Activity, StrictMode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useRoomsClientScrollOnHistoryLoaded } from "./use-rooms-client-scroll-on-history-loaded";

describe("useRoomsClientScrollOnHistoryLoaded", () => {
  it("scrolls to bottom in the layout phase when messagesPending transitions from true to false", () => {
    const events: string[] = [];
    const scrollToBottom = vi.fn(() => {
      events.push("scroll");
    });

    function Probe({
      messagesPending,
      opensAtUnread,
    }: {
      messagesPending: boolean;
      opensAtUnread: boolean;
    }) {
      // Registered before the hook so swapping useLayoutEffect for useEffect fails.
      useEffect(() => {
        events.push(`passive:${messagesPending}`);
      }, [messagesPending]);
      useRoomsClientScrollOnHistoryLoaded(
        messagesPending,
        opensAtUnread,
        scrollToBottom,
      );
      return null;
    }

    const { rerender, unmount } = render(
      <Probe messagesPending={true} opensAtUnread={false} />,
    );
    expect(scrollToBottom).not.toHaveBeenCalled();

    events.length = 0;
    rerender(<Probe messagesPending={false} opensAtUnread={false} />);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["scroll", "passive:false"]);

    // Subsequent renders while not pending do not scroll again.
    rerender(<Probe messagesPending={false} opensAtUnread={false} />);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("does not scroll when opensAtUnread is true", () => {
    const scrollToBottom = vi.fn();

    function Probe({
      messagesPending,
      opensAtUnread,
    }: {
      messagesPending: boolean;
      opensAtUnread: boolean;
    }) {
      useRoomsClientScrollOnHistoryLoaded(
        messagesPending,
        opensAtUnread,
        scrollToBottom,
      );
      return null;
    }

    const { rerender, unmount } = render(
      <Probe messagesPending={true} opensAtUnread={true} />,
    );
    rerender(<Probe messagesPending={false} opensAtUnread={true} />);
    expect(scrollToBottom).not.toHaveBeenCalled();

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal transitions", () => {
    const scrollToBottom = vi.fn();

    function Probe({ messagesPending }: { messagesPending: boolean }) {
      useRoomsClientScrollOnHistoryLoaded(
        messagesPending,
        false,
        scrollToBottom,
      );
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe messagesPending={true} />
        </Activity>
      </StrictMode>,
    );
    expect(scrollToBottom).not.toHaveBeenCalled();

    // Hide while still pending, then flip to loaded while hidden, then reveal.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe messagesPending={false} />
        </Activity>
      </StrictMode>,
    );
    expect(scrollToBottom).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe messagesPending={false} />
        </Activity>
      </StrictMode>,
    );
    // Only the first layout pass sees wasPending=true -> false; StrictMode's
    // replay sees wasHistoryPendingRef already updated to false.
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    unmount();
  });
});
