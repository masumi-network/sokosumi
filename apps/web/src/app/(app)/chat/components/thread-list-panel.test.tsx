import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatRoomMessage,
  ChatRoomThread,
} from "@/lib/clients/generated/core";
import { ThreadListPanel } from "./thread-list-panel";

const listThreadsActionMock = vi.fn();
const markAllUnreadThreadsReadActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listThreadsAction: (...args: unknown[]) => listThreadsActionMock(...args),
  markAllUnreadThreadsReadAction: (...args: unknown[]) =>
    markAllUnreadThreadsReadActionMock(...args),
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const labels = {
  title: "Threads",
  markAllRead: "Mark all as read",
  empty: "No threads yet.",
  loading: "Loading threads…",
  error: "Could not load threads.",
  markAllReadError: "Could not mark unread threads as read.",
  loadOlder: "Load older threads",
  startedBy: (name: string) => `Started by ${name}`,
  unreadReplies: (count: number) =>
    count === 1 ? "1 unread reply" : `${count} unread replies`,
  replies: (count: number) => (count === 1 ? "1 reply" : `${count} replies`),
  close: "Close threads",
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

function threadItem(overrides: Partial<ChatRoomThread> = {}): ChatRoomThread {
  return {
    parentMessage: parentMessage(),
    replyCount: 2,
    lastReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    unreadReplyCount: 2,
    lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    hasLooked: true,

    ...overrides,
  };
}

function renderPanel(
  options: {
    onOpenThread?: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
    onClose?: () => void;
    onAllThreadsLooked?: () => void;
  } = {},
) {
  return render(
    <ThreadListPanel
      roomId={ROOM_ID}
      labels={labels}
      onOpenThread={options.onOpenThread ?? vi.fn().mockResolvedValue(true)}
      onClose={options.onClose ?? vi.fn()}
      onAllThreadsLooked={options.onAllThreadsLooked}
    />,
  );
}

describe("ThreadListPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [threadItem()],
        nextCursor: null,
      },
    });
    markAllUnreadThreadsReadActionMock.mockResolvedValue({
      ok: true,
      value: { markedCount: 1 },
    });
  });

  it("lists unread then looked threads with distinct reply copy", async () => {
    const lookedId = "550e8400-e29b-41d4-a716-446655440099";
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem(),
          threadItem({
            parentMessage: parentMessage({
              id: lookedId,
              content: "Old standup notes",
            }),
            replyCount: 4,
            unreadReplyCount: 0,
            lastUnreadReplyAt: null,
            hasLooked: true,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledWith(ROOM_ID);
    });

    const items = await screen.findAllByTestId("thread-list-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Budget review parent");
    expect(items[0]).toHaveTextContent("2 unread replies");
    expect(items[1]).toHaveTextContent("Old standup notes");
    expect(items[1]).toHaveTextContent("4 replies");
    expect(items[1]).not.toHaveTextContent("unread");
  });

  it("shows empty state when the room has no threads", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: { threads: [], nextCursor: null },
    });

    renderPanel();

    expect(await screen.findByTestId("thread-list-empty")).toHaveTextContent(
      labels.empty,
    );
    expect(
      screen.queryByTestId("thread-list-mark-all-read"),
    ).not.toBeInTheDocument();
  });

  it("loads older threads when the recency cursor is present", async () => {
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Last month",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: null,
        },
      });

    renderPanel();

    fireEvent.click(await screen.findByTestId("thread-list-load-older"));
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenLastCalledWith(ROOM_ID, {
        cursor: "cursor-1",
      });
    });
    expect(await screen.findByText("Last month")).toBeInTheDocument();
    expect(
      screen.queryByTestId("thread-list-load-older"),
    ).not.toBeInTheDocument();
  });

  it("selects a row and marks all unread", async () => {
    const onOpenThread = vi.fn().mockResolvedValue(true);
    const onAllThreadsLooked = vi.fn();
    renderPanel({ onOpenThread, onAllThreadsLooked });

    fireEvent.click(await screen.findByTestId("thread-list-item"));
    expect(onOpenThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    );

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalledWith(ROOM_ID);
    });
    expect(onAllThreadsLooked).toHaveBeenCalledTimes(1);
  });

  it("refetches the first page after mark-all so recency and cursor stay consistent", async () => {
    const olderUnreadId = "550e8400-e29b-41d4-a716-446655440097";
    const recentLookedId = "550e8400-e29b-41d4-a716-446655440096";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderUnreadId,
                content: "Older unread",
              }),
              lastReplyAt: new Date("2026-07-01T00:00:00.000Z"),
              unreadReplyCount: 1,
            }),
            threadItem({
              parentMessage: parentMessage({
                id: recentLookedId,
                content: "Recent looked",
              }),
              lastReplyAt: new Date("2026-08-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: recentLookedId,
                content: "Recent looked",
              }),
              lastReplyAt: new Date("2026-08-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
            threadItem({
              parentMessage: parentMessage({
                id: olderUnreadId,
                content: "Older unread",
              }),
              lastReplyAt: new Date("2026-07-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-2",
        },
      });

    renderPanel();

    const before = await screen.findAllByTestId("thread-list-item");
    expect(before[0]).toHaveTextContent("Older unread");
    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    });
    const after = screen.getAllByTestId("thread-list-item");
    expect(after[0]).toHaveTextContent("Recent looked");
    expect(after[1]).toHaveTextContent("Older unread");
    expect(after[1]).toHaveTextContent("2 replies");
    expect(after[1]).not.toHaveTextContent("unread replies");
    expect(screen.getByTestId("thread-list-load-older")).toBeInTheDocument();
  });

  it("shows unread chrome and Mark all for never-looked Participant threads", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem({
            unreadReplyCount: 37,
            hasLooked: false,
            replyCount: 37,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const item = await screen.findByTestId("thread-list-item");
    expect(item).toHaveAttribute("data-unread", "true");
    expect(item).toHaveTextContent("37 unread replies");
    expect(
      within(item).getByTestId("thread-list-unread-dot"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("thread-list-mark-all-read"),
    ).toBeInTheDocument();
  });

  it("does not treat never-looked with only pre-join or self replies as attention", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem({
            unreadReplyCount: 0,
            lastUnreadReplyAt: null,
            hasLooked: false,

            replyCount: 4,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const item = await screen.findByTestId("thread-list-item");
    expect(item).toHaveAttribute("data-unread", "false");
    expect(item).toHaveTextContent("4 replies");
    expect(item).not.toHaveTextContent("unread");
    expect(
      within(item).queryByTestId("thread-list-unread-dot"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("thread-list-mark-all-read"),
    ).not.toBeInTheDocument();
  });
});
