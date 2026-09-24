import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadThreadReplyCounts } from "@/app/chat/hooks/use-unread-thread-reply-counts";

const listUnreadThreadReplyCountsAction = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listUnreadThreadReplyCountsAction: (roomId: string) =>
    listUnreadThreadReplyCountsAction(roomId),
}));

function Probe({ roomId, refreshKey }: { roomId: string; refreshKey: string }) {
  const { replyCounts, clear } = useUnreadThreadReplyCounts(roomId, refreshKey);
  return (
    <>
      <span data-testid="count">{replyCounts?.size ?? 0}</span>
      <span data-testid="parent-a">{replyCounts?.get("parent-a") ?? "-"}</span>
      <button type="button" onClick={() => clear((id) => id === "parent-a")}>
        look at parent-a
      </button>
    </>
  );
}

/** A successful read naming `threads` unread threads, the first "parent-a". */
function unread(threads: number, parentAReplies = 1) {
  return {
    ok: true as const,
    value: Array.from({ length: threads }, (_, index) => ({
      parentMessageId: index === 0 ? "parent-a" : `parent-${index}`,
      unreadReplyCount: index === 0 ? parentAReplies : 1,
    })),
  };
}

describe("useUnreadThreadReplyCounts", () => {
  beforeEach(() => {
    listUnreadThreadReplyCountsAction.mockReset();
  });

  it("reports the room's unread threads and each one's replies", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(4, 3));
    render(<Probe roomId="room-1" refreshKey="0:false" />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("4");
    });
    expect(screen.getByTestId("parent-a")).toHaveTextContent("3");
    expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledWith("room-1");
  });

  it("re-counts when the refresh key moves", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(2));
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("2");
    });

    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(0));
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("0");
    });
  });

  it("drops a looked-at thread at once, before the re-read", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(3, 2));
    render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("3");
    });

    fireEvent.click(screen.getByRole("button", { name: "look at parent-a" }));

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("parent-a")).toHaveTextContent("-");
  });

  it("answers nothing until the room's first read lands", () => {
    listUnreadThreadReplyCountsAction.mockReturnValue(
      new Promise(() => undefined),
    );
    render(<Probe roomId="room-1" refreshKey="0:false" />);

    expect(screen.getByTestId("parent-a")).toHaveTextContent("-");
  });

  it("never shows the previous room's count", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(5));
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("5");
    });

    listUnreadThreadReplyCountsAction.mockReturnValue(
      new Promise(() => undefined),
    );
    view.rerender(<Probe roomId="room-2" refreshKey="0:false" />);

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("parent-a")).toHaveTextContent("-");
  });

  it("keeps the last count when the count fails", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(3));
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("3");
    });

    listUnreadThreadReplyCountsAction.mockResolvedValue({
      ok: false,
      error: { message: "nope" },
    });
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);

    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("keeps the last count when the count rejects", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue(unread(3));
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("3");
    });

    // A server action rejects rather than answering with a result when the
    // POST comes back as something other than RSC. Without a rejection
    // handler it escapes as an unhandled rejection, which is what Sentry
    // issue SOKOSUMI-E3 records.
    listUnreadThreadReplyCountsAction.mockRejectedValue(
      new Error("An unexpected response was received from the server."),
    );
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);

    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("ignores a count that lands after the key already moved", async () => {
    let settleFirst: ((value: unknown) => void) | undefined;
    listUnreadThreadReplyCountsAction.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    // The first read has to be in flight, not still inside the burst window,
    // or there is no out-of-order answer to ignore.
    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(1);
    });

    listUnreadThreadReplyCountsAction.mockResolvedValueOnce(unread(1));
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });

    // The stale request answers last, with the number that was true before the
    // reader read a thread. It must not win.
    settleFirst?.(unread(9));
    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
