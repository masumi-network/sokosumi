import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
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
  useChatRoomRealtime: () => undefined,
}));

vi.mock("@/lib/ably/use-room-typing", () => ({
  useRoomTyping: () => ({
    typistIds: [],
    handleComposerChange: () => {},
    handleStopTyping: () => {},
  }),
}));

vi.mock("@/lib/ably/use-selected-room-channel-health", () => ({
  useSelectedRoomChannelHealth: () => undefined,
}));

vi.mock("@/app/chat/hooks/use-client-local-calendar-ready", () => ({
  useClientLocalCalendarReady: () => true,
}));

vi.mock(
  "@/app/chat/components/transcript-viewport",
  () => import("./transcript-viewport-stub"),
);

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
  countUnreadThreadsAction: vi.fn(async () => ({
    ok: true as const,
    value: 0,
  })),
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  retryRoomMentionAction: vi.fn(),
  sendRoomMessageAction: vi.fn(),
  setMessageReactionAction: vi.fn(),
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
    forgetRoomRead,
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
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row" data-message-id={message.id}>
      {message.quote ? `quote:${message.quote.authorName}` : message.content}
    </div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
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
    isSelfDirect: false,
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
    pinnedAt: null,
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

function selfDirectRoom(): ChatRoom {
  return {
    ...channelRoom(),
    id: "room-self",
    name: "You",
    slug: null,
    kind: "direct",
    isSelfDirect: true,
    organizationId: null,
    organizationName: null,
    directKey: "direct:self:user-1",
    discoverability: null,
  };
}

/** Send to yourself writes a quote with no body of its own. */
function savedQuoteMessage(): ChatRoomMessage {
  return {
    ...sampleMessage(""),
    id: "msg-saved-quote",
    roomId: "room-self",
    quote: {
      messageId: "source-message",
      roomId: "room-source",
      authorName: "Bob",
      snippet: "Ship the launch notes",
      attachment: null,
    },
  };
}

describe("RoomsClient Self Direct transcript", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: {
          ...selfDirectRoom(),
          id: roomId,
          unreadCount: 0,
          unreadMentionCount: 0,
          markedUnread: false,
        },
      }),
    );
  });

  const selfDirectProps = {
    ...baseProps,
    rooms: [selfDirectRoom()],
    selectedRoomId: "room-self",
  };

  it("shows a quote sent to yourself in the server-rendered history", () => {
    render(
      <RoomsClient {...selfDirectProps} messages={[savedQuoteMessage()]} />,
    );

    expect(screen.getByTestId("chat-message-row")).toHaveAttribute(
      "data-message-id",
      "msg-saved-quote",
    );
  });

  it("shows a quote sent to yourself in hydrated history", async () => {
    let resolvePage!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolvePage = resolve;
    });

    render(
      <RoomsClient {...selfDirectProps} messagesPromise={messagesPromise} />,
    );

    await act(async () => {
      resolvePage({
        messages: [savedQuoteMessage()],
        nextCursor: null,
        failed: false,
      });
      await messagesPromise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "quote:Bob",
    );
  });
});
