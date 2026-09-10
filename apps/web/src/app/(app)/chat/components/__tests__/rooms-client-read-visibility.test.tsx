import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listRoomMessagesAction,
  listThreadMessagesAction,
  markThreadReadAction,
} from "@/app/chat/actions";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import type { RoomMessagesPage } from "@/components/chat/fetch-room-messages";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "@/components/chat/organization-chat-events";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import {
  clearRoomReadOverlays,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably";
import { useChatRoomRealtime } from "@/lib/ably/use-chat-room-realtime";
import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

const { mockIsMobileMedia, mockHeaderRoomSlotHost, mockStreamMessages } =
  vi.hoisted(() => ({
    mockIsMobileMedia: vi.fn((): boolean | undefined => false),
    mockHeaderRoomSlotHost: vi.fn((): HTMLElement | null => null),
    mockStreamMessages: vi.fn((): ChatRoomMessage[] => []),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/chat/rooms/room-1",
  useSearchParams: () => new URLSearchParams(),
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
  useChatRoomRealtime: vi.fn(),
}));

vi.mock("@/lib/ably/use-selected-room-channel-health", () => ({
  useSelectedRoomChannelHealth: () => undefined,
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
    streamOverlayMessages: mockStreamMessages(),
    isStreaming: false,
    activeStreamParentMessageId: null,
    sendStreamMessage: vi.fn(),
    consumePendingStreamMessage: vi.fn(),
  }),
}));

vi.mock("@/app/chat/actions", () => ({
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(async () => ({
    ok: true,
    value: { messages: [], nextCursor: null },
  })),
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  retryRoomMentionAction: vi.fn(),
  sendRoomMessageAction: vi.fn(),
  toggleMessageReactionAction: vi.fn(),
}));

const { fetchRoomMessagesMock } = vi.hoisted(() => ({
  fetchRoomMessagesMock: vi.fn(),
}));

// Scheduled room/thread recovery reads go over GET (SOK-986); thread open
// and user-driven loads still use the actions above.
vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: fetchRoomMessagesMock,
}));

function page(messages: ChatRoomMessage[]): RoomMessagesPage {
  return { messages, nextCursor: null };
}

function roomReads() {
  return fetchRoomMessagesMock.mock.calls.filter(([, parentId]) => !parentId);
}

function threadReads() {
  return fetchRoomMessagesMock.mock.calls.filter(([, parentId]) => parentId);
}

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

vi.mock("@/components/chat/room-read-overlay", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/room-read-overlay")
    >();
  const rememberRoomRead = vi.fn();
  const forgetRoomRead = vi.fn();
  return {
    ...actual,
    rememberRoomRead,
    beginRoomAttentionChange: (room: ChatRoom, previousRoom?: ChatRoom) => {
      rememberRoomRead(room);
      return actual.beginRoomAttentionChange(room, previousRoom);
    },
    settleRoomAttentionChange: (
      roomId: string,
      token: number,
      room: ChatRoom | null,
    ) => {
      const accepted = actual.settleRoomAttentionChange(roomId, token, room);
      if (accepted) {
        if (room) rememberRoomRead(room);
        else forgetRoomRead(roomId);
      }
      return accepted;
    },
  };
});

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
  ChatMessageRow: ({
    message,
    onOpenThread,
  }: {
    message: ChatRoomMessage;
    onOpenThread?: (message: ChatRoomMessage) => void;
  }) => (
    <div data-testid="chat-message-row">
      {message.content}
      <button type="button" onClick={() => onOpenThread?.(message)}>
        Open thread
      </button>
    </div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    replies,
    onClose,
  }: {
    replies: ChatRoomMessage[];
    onClose: () => void;
  }) => (
    <div data-testid="thread-replies">
      {replies.map((reply) => reply.content).join(" ")}
      <button type="button" onClick={onClose}>
        Close thread
      </button>
    </div>
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
  LiveMemberPresenceText: () => null,
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

function sampleMessage(content = "history body"): ChatRoomMessage {
  return {
    id: "msg-real",
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

describe("RoomsClient read visibility", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    vi.clearAllMocks();
    vi.mocked(listRoomMessagesAction)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        value: { messages: [], nextCursor: null },
      });
    fetchRoomMessagesMock.mockReset().mockResolvedValue(page([]));
    mockStreamMessages.mockReturnValue([]);
    vi.mocked(markThreadReadAction).mockResolvedValue({
      ok: true,
      value: { parentMessageId: "msg-real", lastReadAt: new Date() },
    });
    vi.mocked(listThreadMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [], nextCursor: null },
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: { ...channelRoom(), id: roomId },
      }),
    );
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["none", "room", "thread"])(
    "uses one polling loop with pending mentions in %s",
    async (surface) => {
      vi.useFakeTimers();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const mention = {
        id: "mention-1",
        coworkerId: null,
        sokoBotId: "soko-1",
        status: "pending" as const,
        responseMessageId: null,
      };
      const parent = {
        ...sampleMessage(),
        mentions: surface === "room" ? [mention] : [],
        threadReplyCount: surface === "thread" ? 1 : 0,
      };
      const reply = {
        ...sampleMessage("pending thread reply"),
        id: "reply-1",
        parentMessageId: parent.id,
        mentions: [mention],
      };
      vi.mocked(listThreadMessagesAction).mockResolvedValue({
        ok: true,
        value: { messages: [reply], nextCursor: null },
      });
      fetchRoomMessagesMock.mockImplementation(
        async (_roomId: string, parentId?: string | null) =>
          page(parentId ? [reply] : [parent]),
      );
      render(<RoomsClient {...baseProps} messages={[parent]} />);
      await act(async () => {});
      if (surface === "thread") {
        fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
        await act(async () => {});
      }
      fetchRoomMessagesMock.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(roomReads()).toHaveLength(2);
      expect(threadReads()).toHaveLength(surface === "thread" ? 2 : 0);
    },
  );

  it("waits for a stalled poll instead of stacking a second read", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const stalled = Promise.withResolvers<RoomMessagesPage | null>();
    fetchRoomMessagesMock
      .mockReturnValueOnce(stalled.promise)
      .mockResolvedValue(page([sampleMessage("second snapshot")]));
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(33_000);
    });
    // The GET helper bounds the request itself; while it is pending no
    // second read of the same room starts.
    expect(roomReads()).toHaveLength(1);
    await act(async () =>
      stalled.resolve(page([sampleMessage("late snapshot")])),
    );
    expect(screen.getByText("late snapshot")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(roomReads()).toHaveLength(2);
    expect(screen.getByText("second snapshot")).toBeTruthy();
  });

  it("ignores a previous visit's snapshot after returning to the same room", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const previousVisit = Promise.withResolvers<RoomMessagesPage | null>();
    fetchRoomMessagesMock
      .mockReturnValueOnce(previousVisit.promise)
      .mockResolvedValue(page([sampleMessage("fresh visit")]));
    const view = render(
      <RoomsClient {...baseProps} messages={[sampleMessage()]} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    view.rerender(
      <RoomsClient
        {...baseProps}
        rooms={[{ ...channelRoom(), id: "room-other" }]}
        selectedRoomId="room-other"
        messages={[]}
      />,
    );
    view.rerender(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText("fresh visit")).toBeTruthy();
    await act(async () =>
      previousVisit.resolve(page([sampleMessage("previous visit")])),
    );
    expect(screen.queryByText("previous visit")).toBeNull();
    expect(screen.getByText("fresh visit")).toBeTruthy();
  });

  it("ignores a poll from a previous visit to the same thread", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const parent = { ...sampleMessage(), threadReplyCount: 1 };
    const reply = {
      ...sampleMessage("initial reply"),
      id: "reply-1",
      parentMessageId: parent.id,
    };
    const previousVisit = Promise.withResolvers<RoomMessagesPage | null>();
    // Thread open and reopen load through the action; the scheduled poll
    // reads the thread over GET and stalls on the first visit.
    vi.mocked(listThreadMessagesAction)
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [reply], nextCursor: null },
      })
      .mockResolvedValue({
        ok: true,
        value: {
          messages: [{ ...reply, content: "fresh thread visit" }],
          nextCursor: null,
        },
      });
    fetchRoomMessagesMock.mockImplementation(
      (_roomId: string, parentId?: string | null) =>
        parentId ? previousVisit.promise : Promise.resolve(page([parent])),
    );
    render(<RoomsClient {...baseProps} messages={[parent]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    await act(async () => {});
    expect(screen.getByTestId("thread-replies")).toHaveTextContent(
      "fresh thread visit",
    );
    await act(async () =>
      previousVisit.resolve(
        page([{ ...reply, content: "stale thread visit" }]),
      ),
    );
    expect(screen.getByTestId("thread-replies")).toHaveTextContent(
      "fresh thread visit",
    );
    expect(screen.getByTestId("thread-replies")).not.toHaveTextContent(
      "stale thread visit",
    );
  });

  it("applies a successful thread poll when the room poll fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const parent = { ...sampleMessage(), threadReplyCount: 1 };
    const reply = {
      ...sampleMessage("old thread reply"),
      id: "reply-1",
      parentMessageId: parent.id,
    };
    vi.mocked(listThreadMessagesAction).mockResolvedValueOnce({
      ok: true,
      value: { messages: [reply], nextCursor: null },
    });
    fetchRoomMessagesMock.mockImplementation(
      async (_roomId: string, parentId?: string | null) =>
        parentId ? page([{ ...reply, content: "updated thread reply" }]) : null,
    );
    render(<RoomsClient {...baseProps} messages={[parent]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByTestId("thread-replies")).toHaveTextContent(
      "updated thread reply",
    );
  });

  async function deliverMessageInVisibility(
    visibility: DocumentVisibilityState,
  ) {
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get");
    visibilitySpy.mockReturnValue("visible");
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    });
    await act(async () => {});

    visibilitySpy.mockReturnValue(visibility);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    vi.mocked(rememberRoomRead).mockClear();
    const options = vi.mocked(useChatRoomRealtime).mock.calls.at(-1)?.[0];
    expect(options?.onMessage).toBeTypeOf("function");

    const incoming = {
      ...sampleMessage("new message from another member"),
      id: "new-peer-message",
      createdAt: new Date("2026-07-01T12:02:00.000Z"),
      sender: {
        type: "user",
        user: {
          id: "user-2",
          name: "Bob",
          email: "bob@example.com",
          image: null,
          presence: "offline",
        },
      },
    };
    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(JSON.stringify({ eventType: "create", message: incoming })),
    );
    await act(async () => {
      options?.onMessage?.(event);
    });
    expect(document.visibilityState).toBe(visibility);
    expect(screen.getByText("new message from another member")).toBeTruthy();
  }

  it("does not mark a room read when mounted in a hidden tab", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
  });

  it("marks a final answer read when its message ID is unchanged", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { rerender } = render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("partial answer")]}
      />,
    );
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    rerender(
      <RoomsClient {...baseProps} messages={[sampleMessage("final answer")]} />,
    );
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("reads a completed earlier placeholder when the latest message is unchanged", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const newerMessage = {
      ...sampleMessage("Later question"),
      id: "newer-message",
      createdAt: new Date("2026-07-01T12:05:00.000Z"),
    };
    const { rerender } = render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage(""), newerMessage]}
      />,
    );
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    rerender(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("Completed answer"), newerMessage]}
      />,
    );
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it.each(["room", "thread"])(
    "does not mark each local stream token read in the %s, but reads persistence",
    async (surface) => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const initialMessages = [sampleMessage("Initial message")];
      const { rerender } = render(
        <RoomsClient {...baseProps} messages={initialMessages} />,
      );
      if (surface === "thread") {
        fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
      }
      await act(async () => {});
      vi.mocked(markOrganizationChatRoomReadAction).mockClear();
      vi.mocked(markThreadReadAction).mockClear();
      const parentMessageId = surface === "thread" ? "msg-real" : null;
      for (const content of [
        "First",
        "First tokens",
        "First tokens complete",
      ]) {
        mockStreamMessages.mockReturnValue([
          {
            ...sampleMessage(content),
            id: "stream:answer",
            parentMessageId,
          },
        ]);
        rerender(<RoomsClient {...baseProps} messages={initialMessages} />);
        await act(async () => {});
      }
      expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
      expect(markThreadReadAction).not.toHaveBeenCalled();
      mockStreamMessages.mockReturnValue([]);
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(
          JSON.stringify({
            eventType: "create",
            message: {
              ...sampleMessage("First tokens complete"),
              id: "persisted-answer",
              parentMessageId,
              createdAt: new Date("2026-07-01T12:05:00.000Z"),
            },
          }),
        ),
      );
      const callback = vi
        .mocked(useChatRoomRealtime)
        .mock.calls.at(-1)?.[0].onMessage;
      await act(async () => callback?.(event));
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
      if (surface === "thread") {
        expect(markThreadReadAction).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("ignores thought metadata changes on the same message", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { rerender } = render(
      <RoomsClient {...baseProps} messages={[sampleMessage("answer")]} />,
    );
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    rerender(
      <RoomsClient
        {...baseProps}
        messages={[
          {
            ...sampleMessage("answer"),
            metadata: { thought: "more internal thought" },
          },
        ]}
      />,
    );
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
  });

  it("defers a hidden realtime thread reply until the tab becomes visible", async () => {
    const visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    render(
      <RoomsClient
        {...baseProps}
        messages={[{ ...sampleMessage(), threadReplyCount: 1 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    await waitFor(() =>
      expect(screen.getByTestId("thread-replies")).toBeTruthy(),
    );
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    vi.mocked(markThreadReadAction).mockClear();
    visibilitySpy.mockReturnValue("hidden");
    const callback = vi
      .mocked(useChatRoomRealtime)
      .mock.calls.at(-1)?.[0].onMessage;
    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "create",
          message: {
            ...sampleMessage("hidden thread reply"),
            id: "reply-new",
            parentMessageId: "msg-real",
            createdAt: new Date("2026-07-01T12:05:00.000Z"),
          },
        }),
      ),
    );
    await act(async () => callback?.(event));
    expect(screen.getByTestId("thread-replies")).toHaveTextContent(
      "hidden thread reply",
    );
    expect(markThreadReadAction).not.toHaveBeenCalled();
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await act(async () => {
      visibilitySpy.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(markThreadReadAction).toHaveBeenCalledWith(
      "room-channel",
      "msg-real",
    );
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("marks an incoming ordinary message read in the visible selected room", async () => {
    await deliverMessageInVisibility("visible");
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("does not mark an incoming ordinary message read while the tab is hidden", async () => {
    await deliverMessageInVisibility("hidden");
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    expect(rememberRoomRead).not.toHaveBeenCalled();
  });

  it("attaches only the selected room and ignores foreign-room creates", async () => {
    const otherRoom = { ...channelRoom(), id: "room-other", name: "other" };
    publishMembershipVisibleRooms([otherRoom], "org-1", "user-1");
    const seen = vi.fn();
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, seen);
    try {
      render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
      await act(async () => {});

      const options = vi.mocked(useChatRoomRealtime).mock.calls.at(-1)?.[0];
      expect(options?.roomIds).toEqual(["room-channel"]);
      expect(options?.onMessage).toBeTypeOf("function");

      const incoming = {
        ...sampleMessage("foreign room create"),
        id: "foreign-msg",
        roomId: "room-other",
      };
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(JSON.stringify({ eventType: "create", message: incoming })),
      );
      await act(async () => {
        options?.onMessage?.(event);
      });

      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, seen);
    }
  });
});
