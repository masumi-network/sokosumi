import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";
import type {
  ChatRoomMessage,
  ChatRoomThread,
} from "@/lib/clients/generated/core";

const listUnreadThreadsActionMock = vi.fn();
const markAllUnreadThreadsReadActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listUnreadThreadsAction: (...args: unknown[]) =>
    listUnreadThreadsActionMock(...args),
  markAllUnreadThreadsReadAction: (...args: unknown[]) =>
    markAllUnreadThreadsReadActionMock(...args),
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const labels = {
  open: "Unread threads",
  title: "Unread Threads",
  markAllRead: "Mark all as read",
  empty: "No unread threads.",
  loading: "Loading threads…",
  error: "Could not load threads.",
  markAllReadError: "Could not mark unread threads as read.",
  startedBy: (name: string) => `Started by ${name}`,
  unreadReplies: (count: number) =>
    count === 1 ? "1 unread reply" : `${count} unread replies`,
};

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function parentMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Budget review parent",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    metadata: null,
    threadReplyCount: 2,
    threadLastReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    mentions: [],
    quote: null,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

function unreadThreadItem(
  overrides: Partial<ChatRoomThread> = {},
): ChatRoomThread {
  return {
    parentMessage: parentMessage(),
    replyCount: 2,
    lastReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    unreadReplyCount: 2,
    lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    ...overrides,
  };
}

interface RenderPanelOptions {
  attentionRefreshToken?: number;
  onOpenThread?: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
  onAllThreadsLooked?: () => void;
}

function renderPanel(options: RenderPanelOptions = {}) {
  return render(
    <UnreadThreadsPanel
      roomId={ROOM_ID}
      labels={labels}
      attentionRefreshToken={options.attentionRefreshToken ?? 0}
      onOpenThread={options.onOpenThread ?? vi.fn().mockResolvedValue(true)}
      onAllThreadsLooked={options.onAllThreadsLooked}
    />,
  );
}

describe("UnreadThreadsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      data: [unreadThreadItem()],
    });
    markAllUnreadThreadsReadActionMock.mockResolvedValue({
      ok: true,
      data: { markedCount: 1 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens unread threads surface from the header control", async () => {
    renderPanel();

    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(screen.getByTestId("unread-threads-panel")).toBeInTheDocument();
    expect(screen.getByText(labels.title)).toBeInTheDocument();

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalledWith(ROOM_ID);
    });

    expect(await screen.findByTestId("unread-threads-item")).toHaveTextContent(
      "Budget review parent",
    );
    expect(screen.getByText(/Started by Ada/)).toBeInTheDocument();
    expect(screen.getByText("2 unread replies")).toBeInTheDocument();
    expect(
      screen.getByTestId("unread-threads-mark-all-read"),
    ).toHaveTextContent(labels.markAllRead);
  });

  it("shows no badge when there are no unread threads", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({ ok: true, data: [] });

    renderPanel();

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows a plain-text preview instead of raw markdown mentions", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      data: [
        unreadThreadItem({
          parentMessage: parentMessage({
            content:
              "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:noodles Hello **Noodles**",
          }),
        }),
      ],
    });

    renderPanel();

    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    const item = await screen.findByTestId("unread-threads-item");
    expect(item).toHaveTextContent("@noodles Hello Noodles");
    expect(item).not.toHaveTextContent("019fc7e4");
    expect(item).not.toHaveTextContent("**");
  });

  it("shows empty state when nothing needs attention", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({ ok: true, data: [] });

    renderPanel();

    fireEvent.click(screen.getByTestId("unread-threads-trigger"));

    expect(await screen.findByTestId("unread-threads-empty")).toHaveTextContent(
      labels.empty,
    );
    expect(
      screen.queryByTestId("unread-threads-mark-all-read"),
    ).not.toBeInTheDocument();
  });

  it("marks all unread threads as read and clears badge", async () => {
    const onAllThreadsLooked = vi.fn();
    renderPanel({ onAllThreadsLooked });

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-mark-all-read"));

    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalledWith(ROOM_ID);
    });
    expect(await screen.findByTestId("unread-threads-empty")).toHaveTextContent(
      labels.empty,
    );
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-mark-all-read"),
    ).not.toBeInTheDocument();
    expect(onAllThreadsLooked).toHaveBeenCalledTimes(1);
  });

  it("ignores mark-all result after the panel is closed", async () => {
    let resolveMarkAll: ((value: unknown) => void) | undefined;
    markAllUnreadThreadsReadActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMarkAll = resolve;
        }),
    );

    renderPanel();

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-mark-all-read"));

    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalled();
    });

    // Dismiss while mark-all is in flight.
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("unread-threads-panel"),
      ).not.toBeInTheDocument();
    });

    resolveMarkAll?.({ ok: true, data: { markedCount: 1 } });

    // Badge must stay until a fresh successful load clears it — late mark-all
    // must not stomp after dismiss.
    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
  });

  it("opens thread and decrements badge only when look-state persists", async () => {
    const onOpenThread = vi.fn().mockResolvedValue(true);

    renderPanel({ onOpenThread });

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-item"));

    expect(onOpenThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId("unread-threads-panel"),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("unread-threads-badge"),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps badge when mark-read fails", async () => {
    const onOpenThread = vi.fn().mockResolvedValue(false);

    renderPanel({ onOpenThread });

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-item"));

    await waitFor(() => {
      expect(onOpenThread).toHaveBeenCalled();
    });
    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
  });

  it("coalesces rapid attentionRefreshToken bumps into one fetch after 300ms", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const mountCalls = listUnreadThreadsActionMock.mock.calls.length;

    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={2}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={3}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(listUnreadThreadsActionMock).toHaveBeenCalledTimes(mountCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(listUnreadThreadsActionMock).toHaveBeenCalledTimes(mountCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(listUnreadThreadsActionMock).toHaveBeenCalledTimes(mountCalls + 1);
  });

  it("updates badge from live refresh while closed without showing the list", async () => {
    listUnreadThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      data: [],
    });

    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();

    listUnreadThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      data: [unreadThreadItem(), unreadThreadItem()],
    });

    vi.useFakeTimers();
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("unread-threads-badge")).toBeInTheDocument();
    });
    // Count stays available to AT via the trigger label, not the visual badge.
    expect(
      screen.getByRole("button", { name: `${labels.open} (2)` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("unread-threads-item")).not.toBeInTheDocument();
  });

  it("refreshes the open panel list when attentionRefreshToken bumps", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      data: [
        unreadThreadItem({
          parentMessage: parentMessage({ content: "First unread" }),
        }),
      ],
    });

    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(await screen.findByTestId("unread-threads-item")).toHaveTextContent(
      "First unread",
    );
    const callsBeforeLive = listUnreadThreadsActionMock.mock.calls.length;

    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      data: [
        unreadThreadItem({
          parentMessage: parentMessage({
            id: "550e8400-e29b-41d4-a716-446655440099",
            content: "Live refreshed unread",
          }),
        }),
      ],
    });

    vi.useFakeTimers();
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(listUnreadThreadsActionMock.mock.calls.length).toBeGreaterThan(
        callsBeforeLive,
      );
    });
    expect(await screen.findByTestId("unread-threads-item")).toHaveTextContent(
      "Live refreshed unread",
    );
    expect(screen.getByTestId("unread-threads-panel")).toBeInTheDocument();
  });
});
