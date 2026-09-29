import "./rooms-client-harness";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import {
  listThreadMessagesAction,
  listUnreadThreadReplyCountsAction,
  markOrganizationChatRoomReadAction,
  markThreadReadAction,
  mockSearch,
  roomsClientBaseProps,
  useChatRoomRealtimeMock,
} from "./rooms-client-harness";

const { mockSearchHit } = vi.hoisted(() => ({
  mockSearchHit: { current: null as ChatRoomMessage | null },
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: ({
    onJumpToMessage,
  }: {
    onJumpToMessage: (hit: ChatRoomMessage) => void;
  }) => {
    const hit = mockSearchHit.current;
    return hit ? (
      <button
        type="button"
        data-testid="search-hit"
        onClick={() => {
          onJumpToMessage(hit);
        }}
      />
    ) : null;
  },
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onOpenThread,
  }: {
    message: ChatRoomMessage;
    onOpenThread?: (message: ChatRoomMessage) => void;
  }) => (
    <button
      type="button"
      data-testid={`open-thread-${message.id}`}
      data-unread-replies={message.threadUnreadReplyCount ?? 0}
      onClick={() => onOpenThread?.(message)}
    >
      {message.content}
    </button>
  ),
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

/** Capture loading/replies so the race is asserted at the real seam. */
vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    isLoading,
    replies,
    olderLoadStatus,
    onLoadOlder,
    onClose,
  }: {
    isLoading: boolean;
    replies: ChatRoomMessage[];
    olderLoadStatus?: string;
    onLoadOlder: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="thread-panel" data-older-status={olderLoadStatus}>
      <span data-testid="thread-loading">{String(isLoading)}</span>
      <span data-testid="thread-reply-count">{replies.length}</span>
      <span data-testid="thread-state">
        {isLoading ? "loading" : replies.length === 0 ? "empty" : "replies"}
      </span>
      <button
        type="button"
        data-testid="thread-load-older"
        onClick={onLoadOlder}
      >
        load older
      </button>
      <button type="button" data-testid="thread-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => null,
}));

function parentMessage(): ChatRoomMessage {
  return {
    id: "parent-1",
    roomId: "room-channel",
    parentMessageId: null,
    content: "Parent with replies",
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 2,
    threadLastReplyAt: new Date("2026-07-01T12:02:00.000Z"),
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

function replyMessage(id: string): ChatRoomMessage {
  return {
    ...parentMessage(),
    id,
    parentMessageId: "parent-1",
    content: `Reply ${id}`,
    threadReplyCount: 0,
    threadLastReplyAt: null,
  };
}

const baseProps = roomsClientBaseProps({ messages: [parentMessage()] });

describe("RoomsClient thread open loading race", () => {
  beforeEach(() => {
    mockSearchHit.current = null;
    mockSearch.current = "";
    markThreadReadAction.mockReset();
    listThreadMessagesAction.mockReset();
    listUnreadThreadReplyCountsAction.mockClear();
    markOrganizationChatRoomReadAction.mockReset();
    markOrganizationChatRoomReadAction.mockResolvedValue({
      ok: true as const,
      value: {
        id: "room-channel",
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      },
    });
  });

  it("paints loading (not empty) while mark-read is still pending", async () => {
    // Regression: mark-read used to await before isLoading flipped true,
    // so ThreadPanel painted empty with replies still [].
    let resolveMark!: (value: {
      ok: true;
      value: { lookedAt: string };
    }) => void;
    markThreadReadAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: {
        messages: [replyMessage("r1"), replyMessage("r2")],
        nextCursor: null,
      },
    });

    render(<RoomsClient {...baseProps} />);

    fireEvent.click(screen.getByTestId("open-thread-parent-1"));

    // Sync paint after open: panel open, loading true, zero replies yet.
    expect(screen.getByTestId("thread-panel")).toBeTruthy();
    expect(screen.getByTestId("thread-state").textContent).toBe("loading");
    expect(screen.getByTestId("thread-loading").textContent).toBe("true");
    expect(screen.getByTestId("thread-reply-count").textContent).toBe("0");
    // mark-read still in flight — list must not have been called yet either
    // if sequencing kept mark first, but loading must already be true.
    expect(markThreadReadAction).toHaveBeenCalled();

    await act(async () => {
      resolveMark({
        ok: true,
        value: { lookedAt: new Date().toISOString() },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("thread-state").textContent).toBe("replies");
    });
    expect(screen.getByTestId("thread-loading").textContent).toBe("false");
    expect(screen.getByTestId("thread-reply-count").textContent).toBe("2");
  });

  it("clears the parent's unread replies once the thread has been looked at", async () => {
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [replyMessage("r1")], nextCursor: null },
    });

    render(
      <RoomsClient
        {...baseProps}
        messages={[{ ...parentMessage(), threadUnreadReplyCount: 2 }]}
      />,
    );
    const row = screen.getByTestId("open-thread-parent-1");
    expect(row.getAttribute("data-unread-replies")).toBe("2");

    fireEvent.click(row);

    await waitFor(() => {
      expect(
        screen
          .getByTestId("open-thread-parent-1")
          .getAttribute("data-unread-replies"),
      ).toBe("0");
    });
  });

  it("tints the replied-to parent's bar from the unread read after a live reply", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue({
      ok: true as const,
      value: [],
    });
    const otherParent = { ...parentMessage(), id: "parent-2" };
    render(
      <RoomsClient
        {...baseProps}
        messages={[
          { ...parentMessage(), threadUnreadReplyCount: 0 },
          { ...otherParent, threadUnreadReplyCount: 0 },
        ]}
      />,
    );
    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(1);
    });

    // Core gates the reply for this reader and answers the new map. The
    // broadcast event itself carries no per-reader count.
    listUnreadThreadReplyCountsAction.mockResolvedValue({
      ok: true as const,
      value: [{ parentMessageId: "parent-1", unreadReplyCount: 1 }],
    });
    const onMessage = useChatRoomRealtimeMock.mock.calls.at(-1)?.[0].onMessage;
    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "create",
          message: {
            ...replyMessage("r-live"),
            sender: {
              type: "user",
              user: {
                id: "user-2",
                name: "Grace",
                email: "grace@example.com",
                image: null,
                presence: "online",
              },
            },
          },
        }),
      ),
    );
    await act(async () => onMessage?.(event));

    await waitFor(() => {
      expect(
        screen
          .getByTestId("open-thread-parent-1")
          .getAttribute("data-unread-replies"),
      ).toBe("1");
    });
    expect(
      screen
        .getByTestId("open-thread-parent-2")
        .getAttribute("data-unread-replies"),
    ).toBe("0");
  });

  it("keeps a read thread's bar plain when an older message refresh lands after the read", async () => {
    listUnreadThreadReplyCountsAction.mockResolvedValue({
      ok: true as const,
      value: [],
    });
    const view = render(
      <RoomsClient
        {...baseProps}
        messages={[{ ...parentMessage(), threadUnreadReplyCount: 0 }]}
      />,
    );
    await waitFor(() => {
      expect(listUnreadThreadReplyCountsAction).toHaveBeenCalledTimes(1);
    });

    // A page computed before the reader looked at the thread arrives late,
    // still counting its replies as unread.
    view.rerender(
      <RoomsClient
        {...baseProps}
        messages={[{ ...parentMessage(), threadUnreadReplyCount: 2 }]}
      />,
    );

    expect(
      screen
        .getByTestId("open-thread-parent-1")
        .getAttribute("data-unread-replies"),
    ).toBe("0");
  });

  // The sidebar's overflow row asks for the thread list on the room's URL.
  it("opens the thread list the URL asks for", async () => {
    mockSearch.current = "threads=1";

    render(<RoomsClient {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("thread-list-panel")).toBeTruthy();
    });
  });

  it("opens no thread list when the URL asks for nothing", () => {
    render(<RoomsClient {...baseProps} />);

    expect(screen.queryByTestId("thread-list-panel")).toBeNull();
  });

  it("invalidates in-flight load when the panel is closed mid-fetch", async () => {
    let resolveMark!: (value: {
      ok: true;
      value: { lookedAt: string };
    }) => void;
    markThreadReadAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: {
        messages: [replyMessage("r1")],
        nextCursor: null,
      },
    });

    render(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-parent-1"));
    expect(screen.getByTestId("thread-state").textContent).toBe("loading");

    fireEvent.click(screen.getByTestId("thread-close"));
    expect(screen.queryByTestId("thread-panel")).toBeNull();

    await act(async () => {
      resolveMark({
        ok: true,
        value: { lookedAt: new Date().toISOString() },
      });
    });

    // Stale resolve must not remount the panel or leave a stuck open state.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("thread-panel")).toBeNull();
  });

  it("marks the older-thread boundary failed after a failed page", async () => {
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listThreadMessagesAction
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          messages: [replyMessage("r1")],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: { message: "boom" },
      } as never);

    render(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-parent-1"));

    await waitFor(() => {
      expect(screen.getByTestId("thread-state").textContent).toBe("replies");
    });
    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-older-status",
      "idle",
    );

    fireEvent.click(screen.getByTestId("thread-load-older"));

    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-older-status",
        "failed",
      );
    });
    expect(listThreadMessagesAction).toHaveBeenCalledTimes(2);
  });

  it("drops an in-flight older page when a jump window replaces the thread", async () => {
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });

    let resolveAround!: (value: {
      ok: true;
      value: { messages: ChatRoomMessage[]; nextCursor: string | null };
    }) => void;
    let failOlder!: (value: { ok: false; error: { message: string } }) => void;

    listThreadMessagesAction.mockImplementation(
      async (
        _roomId,
        _parentId,
        options?: { around?: string; cursor?: string },
      ) => {
        if (options?.around) {
          return new Promise((resolve) => {
            resolveAround = resolve;
          });
        }
        if (options?.cursor) {
          return new Promise((resolve) => {
            failOlder = resolve;
          });
        }
        return {
          ok: true as const,
          value: {
            messages: [replyMessage("r1")],
            nextCursor: "cursor-1",
          },
        };
      },
    );

    mockSearchHit.current = replyMessage("r-old");

    render(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-parent-1"));

    await waitFor(() => {
      expect(screen.getByTestId("thread-state").textContent).toBe("replies");
    });

    fireEvent.click(screen.getByTestId("search-hit"));

    await waitFor(() => {
      expect(listThreadMessagesAction).toHaveBeenCalledWith(
        "room-channel",
        "parent-1",
        { around: "r-old" },
      );
    });

    fireEvent.click(screen.getByTestId("thread-load-older"));

    await act(async () => {
      resolveAround({
        ok: true,
        value: {
          messages: [replyMessage("r-old")],
          nextCursor: "around-cursor",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("thread-reply-count").textContent).toBe("1");
    });
    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-older-status",
      "idle",
    );

    await act(async () => {
      failOlder({ ok: false, error: { message: "boom" } });
      await Promise.resolve();
    });

    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-older-status",
      "idle",
    );
    expect(screen.getByTestId("thread-reply-count").textContent).toBe("1");
  });
});
