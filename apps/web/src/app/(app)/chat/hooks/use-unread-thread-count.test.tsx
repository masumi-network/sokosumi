import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadThreadCount } from "@/app/chat/hooks/use-unread-thread-count";

const countUnreadThreadsAction = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  countUnreadThreadsAction: (roomId: string) =>
    countUnreadThreadsAction(roomId),
}));

function Probe({ roomId, refreshKey }: { roomId: string; refreshKey: string }) {
  const count = useUnreadThreadCount(roomId, refreshKey);
  return <span data-testid="count">{count}</span>;
}

describe("useUnreadThreadCount", () => {
  beforeEach(() => {
    countUnreadThreadsAction.mockReset();
  });

  it("reports the room's unread threads", async () => {
    countUnreadThreadsAction.mockResolvedValue({ ok: true, value: 4 });
    render(<Probe roomId="room-1" refreshKey="0:false" />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("4");
    });
    expect(countUnreadThreadsAction).toHaveBeenCalledWith("room-1");
  });

  it("re-counts when the refresh key moves", async () => {
    countUnreadThreadsAction.mockResolvedValue({ ok: true, value: 2 });
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("2");
    });

    countUnreadThreadsAction.mockResolvedValue({ ok: true, value: 0 });
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("0");
    });
  });

  it("never shows the previous room's count", async () => {
    countUnreadThreadsAction.mockResolvedValue({ ok: true, value: 5 });
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("5");
    });

    countUnreadThreadsAction.mockReturnValue(new Promise(() => undefined));
    view.rerender(<Probe roomId="room-2" refreshKey="0:false" />);

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("keeps the last count when the count fails", async () => {
    countUnreadThreadsAction.mockResolvedValue({ ok: true, value: 3 });
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("3");
    });

    countUnreadThreadsAction.mockResolvedValue({
      ok: false,
      error: { message: "nope" },
    });
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);

    await waitFor(() => {
      expect(countUnreadThreadsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("ignores a count that lands after the key already moved", async () => {
    let settleFirst: ((value: unknown) => void) | undefined;
    countUnreadThreadsAction.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    const view = render(<Probe roomId="room-1" refreshKey="0:false" />);
    // The first read has to be in flight, not still inside the burst window,
    // or there is no out-of-order answer to ignore.
    await waitFor(() => {
      expect(countUnreadThreadsAction).toHaveBeenCalledTimes(1);
    });

    countUnreadThreadsAction.mockResolvedValueOnce({ ok: true, value: 1 });
    view.rerender(<Probe roomId="room-1" refreshKey="1:false" />);
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });

    // The stale request answers last, with the number that was true before the
    // reader read a thread. It must not win.
    settleFirst?.({ ok: true, value: 9 });
    await waitFor(() => {
      expect(countUnreadThreadsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
