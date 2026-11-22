import { act, render, screen, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRoomThreadActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/actions", () => ({
  getRoomThreadAction: getRoomThreadActionMock,
}));

import { useThreadMuteStatus } from "./use-thread-mute-status";

function MuteProbe({
  roomId,
  parentMessageId,
  replyCount,
}: {
  roomId: string;
  parentMessageId: string;
  replyCount: number;
}) {
  const { muted, setThreadMuted } = useThreadMuteStatus(
    roomId,
    parentMessageId,
    replyCount,
  );
  return (
    <div>
      <span data-testid="muted">{String(muted)}</span>
      <button type="button" onClick={() => setThreadMuted(true)}>
        mute
      </button>
    </div>
  );
}

describe("useThreadMuteStatus", () => {
  beforeEach(() => {
    getRoomThreadActionMock.mockReset();
  });

  it("loads mute status while unknown, re-reads when replyCount changes while unknown, and stops reading once known", async () => {
    getRoomThreadActionMock
      .mockResolvedValueOnce({ ok: false, error: { message: "not a thread" } })
      .mockResolvedValueOnce({ ok: true, value: { mutedAt: null } });

    const { rerender, unmount } = render(
      <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={0} />,
    );
    await waitFor(() =>
      expect(getRoomThreadActionMock).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId("muted")).toHaveTextContent("null");

    rerender(
      <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={1} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("muted")).toHaveTextContent("false"),
    );
    expect(getRoomThreadActionMock).toHaveBeenCalledTimes(2);

    // Once known, a replyCount bump must not trigger another read.
    rerender(
      <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={2} />,
    );
    expect(getRoomThreadActionMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("ignores late results after unmount or Activity hide, and re-reads on reveal while still unknown", async () => {
    const first = Promise.withResolvers<{
      ok: true;
      value: { mutedAt: string | null };
    }>();
    const second = Promise.withResolvers<{
      ok: true;
      value: { mutedAt: string | null };
    }>();
    getRoomThreadActionMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={1} />
      </Activity>,
    );
    expect(getRoomThreadActionMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={1} />
      </Activity>,
    );
    await act(async () => {
      first.resolve({ ok: true, value: { mutedAt: "2026-11-20T00:00:00Z" } });
      await first.promise;
    });
    expect(screen.getByTestId("muted")).toHaveTextContent("null");

    rerender(
      <Activity mode="visible">
        <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={1} />
      </Activity>,
    );
    expect(getRoomThreadActionMock).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      second.resolve({ ok: true, value: { mutedAt: "2026-11-20T00:00:00Z" } });
      await second.promise;
    });
  });

  it("matches StrictMode replay read calls while state is unknown", async () => {
    getRoomThreadActionMock.mockResolvedValue({
      ok: true,
      value: { mutedAt: null },
    });
    const { unmount } = render(
      <StrictMode>
        <MuteProbe roomId="room-1" parentMessageId="msg-1" replyCount={1} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("muted")).toHaveTextContent("false"),
    );
    expect(getRoomThreadActionMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
