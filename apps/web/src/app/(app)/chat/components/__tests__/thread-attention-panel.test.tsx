import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadAttentionPanel } from "@/app/chat/components/thread-attention-panel";
import type {
  ChatRoomMessage,
  ChatRoomThreadAttentionItem,
} from "@/lib/clients/generated/core";

const listThreadAttentionActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listThreadAttentionAction: (...args: unknown[]) =>
    listThreadAttentionActionMock(...args),
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const labels = {
  open: "Unread threads",
  title: "Unread Threads",
  empty: "No unread threads.",
  loading: "Loading threads…",
  error: "Could not load threads.",
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

function attentionItem(
  overrides: Partial<ChatRoomThreadAttentionItem> = {},
): ChatRoomThreadAttentionItem {
  return {
    parentMessage: parentMessage(),
    unreadReplyCount: 2,
    lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    ...overrides,
  };
}

describe("ThreadAttentionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listThreadAttentionActionMock.mockResolvedValue({
      ok: true,
      data: [attentionItem()],
    });
  });

  it("opens attention surface from the header control", async () => {
    render(
      <ThreadAttentionPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId("thread-attention-panel"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("thread-attention-trigger"));
    expect(screen.getByTestId("thread-attention-panel")).toBeInTheDocument();
    expect(screen.getByText(labels.title)).toBeInTheDocument();

    await waitFor(() => {
      expect(listThreadAttentionActionMock).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });

    expect(
      await screen.findByTestId("thread-attention-item"),
    ).toHaveTextContent("Budget review parent");
    expect(screen.getByText(/Started by Ada/)).toBeInTheDocument();
    expect(screen.getByText("2 unread replies")).toBeInTheDocument();
  });

  it("shows a plain-text preview instead of raw markdown mentions", async () => {
    listThreadAttentionActionMock.mockResolvedValue({
      ok: true,
      data: [
        attentionItem({
          parentMessage: parentMessage({
            content:
              "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:noodles Hello **Noodles**",
          }),
        }),
      ],
    });

    render(
      <ThreadAttentionPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("thread-attention-trigger"));
    const item = await screen.findByTestId("thread-attention-item");
    expect(item).toHaveTextContent("@noodles Hello Noodles");
    expect(item).not.toHaveTextContent("019fc7e4");
    expect(item).not.toHaveTextContent("**");
  });

  it("shows empty state when nothing needs attention", async () => {
    listThreadAttentionActionMock.mockResolvedValue({ ok: true, data: [] });

    render(
      <ThreadAttentionPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("thread-attention-trigger"));

    expect(
      await screen.findByTestId("thread-attention-empty"),
    ).toHaveTextContent(labels.empty);
  });

  it("opens thread and closes panel on row click", async () => {
    const onOpenThread = vi.fn();

    render(
      <ThreadAttentionPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onOpenThread={onOpenThread}
      />,
    );

    fireEvent.click(screen.getByTestId("thread-attention-trigger"));
    fireEvent.click(await screen.findByTestId("thread-attention-item"));

    expect(onOpenThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId("thread-attention-panel"),
      ).not.toBeInTheDocument();
    });
  });
});
