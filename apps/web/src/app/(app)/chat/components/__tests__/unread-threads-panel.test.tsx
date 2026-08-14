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

vi.mock("@/app/chat/actions", () => ({
  listUnreadThreadsAction: (...args: unknown[]) =>
    listUnreadThreadsActionMock(...args),
}));

const labels = {
  open: "Threads",
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
    hasLooked: true,
    attentionReplyCount: 2,
    ...overrides,
  };
}

function renderTrigger(
  options: {
    attentionRefreshToken?: number;
    isOpen?: boolean;
    onToggle?: () => void;
  } = {},
) {
  return render(
    <UnreadThreadsPanel
      roomId={ROOM_ID}
      labels={labels}
      attentionRefreshToken={options.attentionRefreshToken ?? 0}
      isOpen={options.isOpen ?? false}
      onToggle={options.onToggle ?? vi.fn()}
    />,
  );
}

describe("UnreadThreadsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      value: [unreadThreadItem()],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a badge and toggles the thread list from the header control", async () => {
    const onToggle = vi.fn();
    renderTrigger({ onToggle });

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
  });

  it("shows no badge when there are no unread threads", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({ ok: true, value: [] });

    renderTrigger();

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows badge for never-looked attention threads (ADR-0005 unreadReplyCount 0)", async () => {
    listUnreadThreadsActionMock.mockResolvedValue({
      ok: true,
      value: [
        unreadThreadItem({
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
          hasLooked: false,
          attentionReplyCount: 37,
          replyCount: 37,
        }),
      ],
    });

    renderTrigger();

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${labels.open} (1)` }),
    ).toBeInTheDocument();
  });

  it("coalesces rapid attentionRefreshToken bumps into one fetch after 300ms", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        isOpen={false}
        onToggle={vi.fn()}
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
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={2}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={3}
        isOpen={false}
        onToggle={vi.fn()}
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

  it("updates badge from live refresh without opening a popover", async () => {
    listUnreadThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      value: [],
    });

    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listUnreadThreadsActionMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();

    listUnreadThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      value: [unreadThreadItem(), unreadThreadItem()],
    });

    vi.useFakeTimers();
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("unread-threads-badge")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: `${labels.open} (2)` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
  });
});
