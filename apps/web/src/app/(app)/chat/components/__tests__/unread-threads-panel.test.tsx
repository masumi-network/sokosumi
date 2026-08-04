import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function parentMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    roomId: "550e8400-e29b-41d4-a716-446655440000",
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

  it("opens unread threads surface from the header control", async () => {
    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    expect(await screen.findByTestId("unread-threads-badge")).toHaveTextContent(
      "1",
    );
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(screen.getByTestId("unread-threads-panel")).toBeInTheDocument();
    expect(screen.getByText(labels.title)).toBeInTheDocument();

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
      );
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

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

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

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    const item = await screen.findByTestId("unread-threads-item");
    expect(item).toHaveTextContent("@noodles Hello Noodles");
    expect(item).not.toHaveTextContent("019fc7e4");
    expect(item).not.toHaveTextContent("**");
  });

  it("shows empty state when nothing needs attention", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByTestId("unread-threads-trigger"));

    expect(await screen.findByTestId("unread-threads-empty")).toHaveTextContent(
      labels.empty,
    );
    expect(
      screen.queryByTestId("unread-threads-mark-all-read"),
    ).not.toBeInTheDocument();
  });

  it("marks all unread threads as read and clears badge", async () => {
    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-mark-all-read"));

    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
      );
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
  });

  it("ignores mark-all result after the panel is closed", async () => {
    let resolveMarkAll: ((value: unknown) => void) | undefined;
    markAllUnreadThreadsReadActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMarkAll = resolve;
        }),
    );

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn().mockResolvedValue(true)}
      />,
    );

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

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={onOpenThread}
      />,
    );

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

    render(
      <UnreadThreadsPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={onOpenThread}
      />,
    );

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    fireEvent.click(await screen.findByTestId("unread-threads-item"));

    await waitFor(() => {
      expect(onOpenThread).toHaveBeenCalled();
    });
    expect(await screen.findByTestId("unread-threads-badge")).toHaveTextContent(
      "1",
    );
  });
});
