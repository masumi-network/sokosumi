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
  listThreadMessagesAction,
  markThreadReadAction,
} from "@/app/chat/actions";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { RoomsClient } from "@/app/chat/components/rooms-client";
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
  ThreadPanel: ({ replies }: { replies: ChatRoomMessage[] }) => (
    <div data-testid="thread-replies">
      {replies.map((reply) => reply.content).join(" ")}
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
    vi.clearAllMocks();
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
    vi.restoreAllMocks();
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
});
