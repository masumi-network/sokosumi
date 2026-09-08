import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";
import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";

const { mockIsMobileMedia, mockHeaderRoomSlotHost } = vi.hoisted(() => ({
  mockIsMobileMedia: vi.fn((): boolean | undefined => false),
  mockHeaderRoomSlotHost: vi.fn((): HTMLElement | null => null),
}));

const { mockReplace, mockSearch } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockSearch: { current: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
  }),
  usePathname: () => "/chat/rooms/room-channel",
  useSearchParams: () => new URLSearchParams(mockSearch.current),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("@/app/chat/components/day-separator", () => ({
  default: () => null,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobileMedia: () => mockIsMobileMedia(),
}));

vi.mock("@/app/components/header/use-header-room-slot-host", () => ({
  useHeaderRoomSlotHost: () => mockHeaderRoomSlotHost(),
}));

vi.mock("@/contexts/breadcrumb-override-context", () => ({
  useRegisterBreadcrumbOverride: () => undefined,
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/ably/use-chat-room-realtime", () => ({
  useChatRoomRealtime: () => undefined,
}));

vi.mock("@/app/chat/hooks/use-client-local-calendar-ready", () => ({
  useClientLocalCalendarReady: () => true,
}));

vi.mock("@/app/chat/hooks/use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    scrollerRef: { current: null },
    contentRef: { current: null },
    contentMinHeight: undefined,
    scrollToBottom: vi.fn(),
    pinToBottomAfterOwnSend: vi.fn(),
    scrollToBottomIfPinned: vi.fn(),
    suppressStickToBottom: vi.fn(),
    releaseStickToBottomSuppress: vi.fn(),
  }),
}));

vi.mock("@/app/chat/hooks/use-coworker-direct-room-stream", () => ({
  readStoredStreamParentMessageId: () => null,
  useCoworkerDirectRoomStream: () => ({
    streamOverlayMessages: [],
    isStreaming: false,
    activeStreamParentMessageId: null,
    sendStreamMessage: vi.fn(),
    consumePendingStreamMessage: vi.fn(),
  }),
}));

vi.mock("@/app/chat/actions", () => ({
  getRoomMessageAction: vi.fn(),
  getRoomThreadAction: vi.fn(),
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  retryRoomMentionAction: vi.fn(),
  sendRoomMessageAction: vi.fn(),
  toggleMessageReactionAction: vi.fn(),
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomReadAction: vi.fn(async (roomId: string) => ({
    ok: true as const,
    value: {
      id: roomId,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    },
  })),
}));

vi.mock("@/components/chat/room-read-overlay", () => ({
  rememberRoomRead: vi.fn(),
  forgetRoomRead: vi.fn(),
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    focusOnMount,
  }: {
    ref?: Ref<RoomComposerHandle>;
    focusOnMount?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-focus-on-mount={String(Boolean(focusOnMount))}
      />
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row">{message.content}</div>
  ),
}));

// Reports which thread was opened and what it holds. A notification for a
// reply is meant to land inside the thread, and the real panel renders far
// more than this test can set up.
vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    parentMessage,
    replies,
  }: {
    parentMessage: ChatRoomMessage | null;
    replies: ChatRoomMessage[];
  }) => (
    <div
      data-testid="thread-panel"
      data-parent-id={parentMessage?.id ?? ""}
      data-reply-ids={replies.map((reply) => reply.id).join(",")}
    />
  ),
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({
    membersLoadFailed,
    members,
    coworkers,
    children,
  }: {
    membersLoadFailed?: boolean;
    members?: unknown[];
    coworkers?: unknown[];
    children?: ReactNode;
  }) => (
    <>
      {children}
      <div
        data-testid="edit-channel-dialog-probe"
        data-members-load-failed={String(Boolean(membersLoadFailed))}
        data-members-count={String(members?.length ?? 0)}
        data-coworkers-count={String(coworkers?.length ?? 0)}
      />
    </>
  ),
}));

vi.mock("../chat-participant-hover-card", () => ({
  ChatParticipantHoverCard: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/chat/channel-discoverability-icon", () => ({
  ChannelDiscoverabilityIcon: () => null,
}));

vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function channelRoom(): ChatRoom {
  return {
    id: "room-channel",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      {
        id: "user-1",
        name: "Ada",
        email: "user-1@example.com",
        image: null,
        presence: "offline",
      },
    ],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
} as Organization;

const baseProps = {
  activeOrganization: organization,
  rooms: [channelRoom()],
  organizationMembers: [] as [],
  currentUserId: "user-1",
  coworkers: [] as [],
  selectedRoomId: "room-channel",
  messageLoadFailed: false,
  membersLoadFailed: false,
  messages: [] as ChatRoomMessage[],
  messagesNextCursor: null as string | null,
};

import { toast } from "sonner";

import {
  getRoomMessageAction,
  getRoomThreadAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markThreadReadAction,
} from "@/app/chat/actions";

function sampleMessage(
  content = "history body",
  id = "msg-real",
): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
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

function settledMessages(messages: ChatRoomMessage[] = []) {
  return Promise.resolve({ messages, nextCursor: null, failed: false });
}

/**
 * The wiring between the URL and the jump, which the helper unit tests cannot
 * see. Every defect review found in this feature lived here rather than in the
 * helpers, because the helpers were always driven by mocked dependencies.
 */
describe("RoomsClient notification deep link", () => {
  beforeEach(() => {
    mockSearch.current = "";
    mockReplace.mockReset();
    vi.mocked(getRoomMessageAction).mockReset();
    vi.mocked(getRoomThreadAction).mockReset();
    vi.mocked(listRoomMessagesAction).mockReset();
    // Reset too, so a test cannot be satisfied by an earlier test's call.
    vi.mocked(listThreadMessagesAction).mockReset();
    vi.mocked(markThreadReadAction).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true as const,
      value: { messages: [], nextCursor: null },
    });
  });

  it("does not read a message when the URL names none", async () => {
    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(getRoomMessageAction).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("reads the message the URL names, in the room on screen", async () => {
    mockSearch.current = "message=msg-1";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: null,
    });

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(getRoomMessageAction).toHaveBeenCalledWith(
        "room-channel",
        "msg-1",
      );
    });
  });

  it("spends the message from the URL so Back cannot jump again", async () => {
    mockSearch.current = "message=msg-1";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: null,
    });

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/chat/rooms/room-channel", {
        scroll: false,
      });
    });
  });

  it("keeps every other query parameter when it spends the message", async () => {
    mockSearch.current = "message=msg-1&notice=room-unavailable";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: null,
    });

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/chat/rooms/room-channel?notice=room-unavailable",
        { scroll: false },
      );
    });
  });

  it("leaves a message that is gone alone, rather than asking for it again", async () => {
    mockSearch.current = "message=msg-1";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: null,
    });

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(getRoomMessageAction).toHaveBeenCalled();
    });
    // The around-window call is what raises an error toast for a message the
    // server has already said nothing about.
    expect(listRoomMessagesAction).not.toHaveBeenCalled();
  });

  it("tries the room window when the read itself failed", async () => {
    mockSearch.current = "message=msg-1";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: false as const,
      error: { message: "boom" },
    } as never);

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(listRoomMessagesAction).toHaveBeenCalledWith("room-channel", {
        around: "msg-1",
      });
    });
  });

  it("ignores a message parameter that is only spaces", async () => {
    mockSearch.current = "message=%20%20";

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(getRoomMessageAction).not.toHaveBeenCalled();
  });

  it("keeps following the room after it jumps to an older message", async () => {
    mockSearch.current = "message=msg-1";
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: { id: "msg-1", parentMessageId: null } as ChatRoomMessage,
    });
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true as const,
      value: {
        messages: [sampleMessage("window body", "msg-window")],
        nextCursor: "cursor-window",
      },
    });

    const { rerender } = render(
      <RoomsClient {...baseProps} messagesPromise={settledMessages()} />,
    );

    await waitFor(() => {
      expect(listRoomMessagesAction).toHaveBeenCalledWith("room-channel", {
        around: "msg-1",
      });
    });

    // A head page arriving after the jump: an Ably reconnect, a room refetch,
    // or the page re-rendering. It has to be merged in. The jump loads a
    // window around an old message and leaves the head on screen, so the room
    // still looks live to the reader, and a room that looks live must not
    // silently drop what arrives in it.
    const headPage = settledMessages([sampleMessage("head body", "msg-head")]);
    await act(async () => {
      rerender(<RoomsClient {...baseProps} messagesPromise={headPage} />);
      await headPage;
    });

    expect(screen.getByText("head body")).toBeInTheDocument();
    // And the window the reader was sent to is still there beside it.
    expect(screen.getByText("window body")).toBeInTheDocument();
  });
  it("opens the thread when the notification names a reply", async () => {
    mockSearch.current = "message=msg-reply";
    const parent = sampleMessage("parent body", "msg-parent");
    const reply: ChatRoomMessage = {
      ...sampleMessage("reply body", "msg-reply"),
      parentMessageId: "msg-parent",
    };

    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: reply,
    });
    vi.mocked(getRoomThreadAction).mockResolvedValue({
      ok: true as const,
      value: {
        parentMessage: parent,
        replyCount: 1,
        lastReplyAt: new Date("2026-07-01T12:02:00.000Z"),
        unreadReplyCount: 0,
        lastUnreadReplyAt: null,
        hasLooked: true,
      },
    });
    vi.mocked(markThreadReadAction).mockResolvedValue({
      ok: true as const,
      value: {
        parentMessageId: "msg-parent",
        lastReadAt: new Date("2026-07-01T12:02:00.000Z"),
      },
    });
    vi.mocked(listThreadMessagesAction).mockResolvedValue({
      ok: true as const,
      value: { messages: [reply], nextCursor: null },
    });

    render(<RoomsClient {...baseProps} messagesPromise={settledMessages()} />);

    // A reply never appears in the room timeline, so landing on the message a
    // notification named means opening the thread that holds it. The id the
    // notification carries names the reply, not the thread, which is why the
    // message is read first and its parent looked up from what comes back.
    await waitFor(() => {
      expect(getRoomThreadAction).toHaveBeenCalledWith(
        "room-channel",
        "msg-parent",
      );
    });
    // The thread is open on the right parent, holding the reply the
    // notification was about.
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-parent-id",
        "msg-parent",
      );
    });
    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-reply-ids",
      "msg-reply",
    );

    // Scrolling the room to a reply cannot work: it is not on that timeline.
    expect(listRoomMessagesAction).not.toHaveBeenCalledWith("room-channel", {
      around: "msg-reply",
    });
  });
  it("drops a thread whose parent arrives after the reader changed rooms", async () => {
    mockSearch.current = "message=msg-reply";
    const parent = sampleMessage("parent body", "msg-parent");
    const reply: ChatRoomMessage = {
      ...sampleMessage("reply body", "msg-reply"),
      parentMessageId: "msg-parent",
    };
    const otherRoom: ChatRoom = { ...channelRoom(), id: "room-other" };

    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: reply,
    });
    vi.mocked(markThreadReadAction).mockResolvedValue({
      ok: true as const,
      value: {
        parentMessageId: "msg-parent",
        lastReadAt: new Date("2026-07-01T12:02:00.000Z"),
      },
    });
    vi.mocked(listThreadMessagesAction).mockResolvedValue({
      ok: true as const,
      value: { messages: [reply], nextCursor: null },
    });

    // Held open so the reader can leave while the parent is still loading.
    let releaseParent = (): void => {};
    vi.mocked(getRoomThreadAction).mockReturnValue(
      new Promise((resolve) => {
        releaseParent = () =>
          resolve({
            ok: true as const,
            value: {
              parentMessage: parent,
              replyCount: 1,
              lastReplyAt: new Date("2026-07-01T12:02:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            },
          });
      }),
    );

    const { rerender } = render(
      <RoomsClient {...baseProps} messagesPromise={settledMessages()} />,
    );

    await waitFor(() => {
      expect(getRoomThreadAction).toHaveBeenCalledWith(
        "room-channel",
        "msg-parent",
      );
    });

    // The real `replace` strips the parameter as soon as the jump is acted
    // on, so the room the reader moves to is not asked to jump as well.
    mockSearch.current = "";
    rerender(
      <RoomsClient
        {...baseProps}
        rooms={[channelRoom(), otherRoom]}
        selectedRoomId="room-other"
        messagesPromise={settledMessages()}
      />,
    );

    await act(async () => {
      releaseParent();
      await Promise.resolve();
    });

    // The parent belongs to the room the reader left. Opening its thread now
    // would put that room's panel over the one they are in, holding no
    // replies, and would close the thread list and roster they just opened.
    expect(screen.queryByTestId("thread-panel")).toBeNull();
  });
  it("says nothing about a room the reader has already left", async () => {
    mockSearch.current = "message=msg-reply";
    const reply: ChatRoomMessage = {
      ...sampleMessage("reply body", "msg-reply"),
      parentMessageId: "msg-parent",
    };
    const otherRoom: ChatRoom = { ...channelRoom(), id: "room-other" };

    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: reply,
    });

    let failParent = (): void => {};
    vi.mocked(getRoomThreadAction).mockReturnValue(
      new Promise((resolve) => {
        failParent = () =>
          resolve({
            ok: false as const,
            error: { code: "INTERNAL_ERROR", message: "Server error" },
          });
      }),
    );

    const { rerender } = render(
      <RoomsClient {...baseProps} messagesPromise={settledMessages()} />,
    );

    await waitFor(() => {
      expect(getRoomThreadAction).toHaveBeenCalledWith(
        "room-channel",
        "msg-parent",
      );
    });

    mockSearch.current = "";
    rerender(
      <RoomsClient
        {...baseProps}
        rooms={[channelRoom(), otherRoom]}
        selectedRoomId="room-other"
        messagesPromise={settledMessages()}
      />,
    );

    await act(async () => {
      failParent();
      await Promise.resolve();
    });

    // The request was for a room the reader has since left, so its failure is
    // not theirs to see. An error toast here reads as a complaint about the
    // room they are looking at now.
    expect(toast.error).not.toHaveBeenCalled();
  });
  /**
   * Every load a jump makes checks the room before it reports a failure, so
   * an error raised for a room the reader has left never lands on the room
   * they moved to. Each of these holds one request open, moves the reader,
   * then fails it.
   */
  describe("a failure for a room the reader has left", () => {
    const serverError = {
      ok: false as const,
      error: { code: "INTERNAL_ERROR", message: "Server error" },
    };

    function otherRoom(): ChatRoom {
      return { ...channelRoom(), id: "room-other" };
    }

    function leaveRoom(rerender: (ui: React.ReactElement) => void) {
      mockSearch.current = "";
      rerender(
        <RoomsClient
          {...baseProps}
          rooms={[channelRoom(), otherRoom()]}
          selectedRoomId="room-other"
          messagesPromise={settledMessages()}
        />,
      );
    }

    it("says nothing when the room window fails", async () => {
      mockSearch.current = "message=msg-1";
      vi.mocked(getRoomMessageAction).mockResolvedValue({
        ok: true as const,
        value: sampleMessage("target", "msg-1"),
      });

      let failWindow = (): void => {};
      vi.mocked(listRoomMessagesAction).mockReturnValue(
        new Promise((resolve) => {
          failWindow = () => resolve(serverError);
        }),
      );

      const { rerender } = render(
        <RoomsClient {...baseProps} messagesPromise={settledMessages()} />,
      );

      await waitFor(() => {
        expect(listRoomMessagesAction).toHaveBeenCalledWith("room-channel", {
          around: "msg-1",
        });
      });

      leaveRoom(rerender);
      await act(async () => {
        failWindow();
        await Promise.resolve();
      });

      expect(toast.error).not.toHaveBeenCalled();
    });

    it("says nothing when the thread's replies fail to load", async () => {
      const parent = sampleMessage("parent body", "msg-parent");
      mockSearch.current = "message=msg-reply";
      vi.mocked(getRoomMessageAction).mockResolvedValue({
        ok: true as const,
        value: {
          ...sampleMessage("reply body", "msg-reply"),
          parentMessageId: "msg-parent",
        },
      });
      vi.mocked(markThreadReadAction).mockResolvedValue({
        ok: true as const,
        value: {
          parentMessageId: "msg-parent",
          lastReadAt: new Date("2026-07-01T12:02:00.000Z"),
        },
      });

      // The parent is already on screen, so the jump opens the thread without
      // fetching it, and the reply list is the request left in flight.
      let failReplies = (): void => {};
      vi.mocked(listThreadMessagesAction).mockReturnValue(
        new Promise((resolve) => {
          failReplies = () => resolve(serverError);
        }),
      );

      const { rerender } = render(
        <RoomsClient
          {...baseProps}
          messages={[parent]}
          messagesPromise={settledMessages([parent])}
        />,
      );

      await waitFor(() => {
        expect(listThreadMessagesAction).toHaveBeenCalledWith(
          "room-channel",
          "msg-parent",
        );
      });

      leaveRoom(rerender);
      await act(async () => {
        failReplies();
        await Promise.resolve();
      });

      expect(toast.error).not.toHaveBeenCalled();
    });

    it("says nothing when the window inside the thread fails", async () => {
      const parent = sampleMessage("parent body", "msg-parent");
      mockSearch.current = "message=msg-reply";
      vi.mocked(getRoomMessageAction).mockResolvedValue({
        ok: true as const,
        value: {
          ...sampleMessage("reply body", "msg-reply"),
          parentMessageId: "msg-parent",
        },
      });
      vi.mocked(markThreadReadAction).mockResolvedValue({
        ok: true as const,
        value: {
          parentMessageId: "msg-parent",
          lastReadAt: new Date("2026-07-01T12:02:00.000Z"),
        },
      });

      // The reply list opens empty, so the reply is not on screen and the
      // jump asks for a window around it. That window is the held request.
      let failWindow = (): void => {};
      vi.mocked(listThreadMessagesAction).mockImplementation(
        async (_roomId, _parentId, options) => {
          if (!options?.around) {
            return {
              ok: true as const,
              value: { messages: [], nextCursor: null },
            };
          }
          return new Promise((resolve) => {
            failWindow = () => resolve(serverError);
          });
        },
      );

      const { rerender } = render(
        <RoomsClient
          {...baseProps}
          messages={[parent]}
          messagesPromise={settledMessages([parent])}
        />,
      );

      await waitFor(() => {
        expect(listThreadMessagesAction).toHaveBeenCalledWith(
          "room-channel",
          "msg-parent",
          { around: "msg-reply" },
        );
      });

      leaveRoom(rerender);
      await act(async () => {
        failWindow();
        await Promise.resolve();
      });

      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
