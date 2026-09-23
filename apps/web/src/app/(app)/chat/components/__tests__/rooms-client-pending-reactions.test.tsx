import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMessageReactionAction } from "@/app/chat/actions";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import { useChatRoomRealtime } from "@/lib/ably/use-chat-room-realtime";
import type {
  ChatRoom,
  ChatRoomMessage,
  ChatRoomMessageReaction,
  Organization,
} from "@/lib/clients/generated/core";

/**
 * A tap shows the viewer's Reaction at once and only the server's answer
 * moves it again (ADR 0032): rollback on failure, last tap wins while a
 * request is out, and live updates never hide the Pending reaction.
 */

const { fetchRoomMessagesMock } = vi.hoisted(() => ({
  fetchRoomMessagesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/chat/rooms/room-channel",
  useSearchParams: () => new URLSearchParams(),
}));

const translate = (key: string) => key;
vi.mock("next-intl", () => ({
  useTranslations: () => translate,
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
  useIsMobileMedia: () => false,
}));

vi.mock("@/app/components/header/use-header-room-slot-host", () => ({
  useHeaderRoomSlotHost: () => null,
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
  listRoomMessagesAction: vi.fn(async () => ({
    ok: true,
    value: { messages: [], nextCursor: null },
  })),
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  pinRoomMessageAction: vi.fn(),
  retryRoomMentionAction: vi.fn(),
  sendRoomMessageAction: vi.fn(),
  setMessageReactionAction: vi.fn(),
  unpinRoomMessageAction: vi.fn(),
}));

vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: fetchRoomMessagesMock,
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
  ChatMessageRow: function ChatMessageRowStub({
    message,
    onToggleReaction,
  }: {
    message: ChatRoomMessage;
    onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  }) {
    return (
      <div
        data-testid="chat-message-row"
        data-message-id={message.id}
        data-reactions={summarize(message.reactions)}
      >
        {message.content}
        <button type="button" onClick={() => onToggleReaction(message, "👍")}>
          {`React ${message.id}`}
        </button>
      </div>
    );
  },
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
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

/** `emoji count reacted names` per entry, e.g. `👍 2 me Bob,Ada`. */
function summarize(reactions: ChatRoomMessageReaction[]): string {
  return reactions
    .map(
      (entry) =>
        `${entry.emoji} ${entry.count} ${entry.reactedByCurrentUser ? "me" : "-"} ${entry.reactors.map((reactor) => reactor.name).join(",")}`,
    )
    .join("|");
}

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
    isSelfDirect: false,
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

function message(
  id: string,
  reactions: ChatRoomMessageReaction[] = [],
): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content: `body ${id}`,
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions,
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
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
}

const BOB_THUMBS: ChatRoomMessageReaction = {
  emoji: "👍",
  count: 1,
  reactedByCurrentUser: false,
  reactors: [{ id: "user-2", name: "Bob" }],
};

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
  messages: [message("m1")],
  messagesNextCursor: null as string | null,
};

type ReactionResult = Awaited<ReturnType<typeof setMessageReactionAction>>;

/** Each call resolves only when the test says so, in call order. */
function deferReactionRequests() {
  const resolvers: Array<(result: ReactionResult) => void> = [];
  vi.mocked(setMessageReactionAction).mockImplementation(
    () =>
      new Promise<ReactionResult>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    calls: () =>
      vi
        .mocked(setMessageReactionAction)
        .mock.calls.map(([, messageId, emoji, reacted]) => ({
          messageId,
          emoji,
          reacted,
        })),
    settle: async (index: number, result: ReactionResult) => {
      await act(async () => {
        resolvers[index]?.(result);
      });
    },
  };
}

function confirmed(reactions: ChatRoomMessageReaction[]): ReactionResult {
  return { ok: true, value: message("m1", reactions) };
}

function reactionsShown(): string {
  return (
    screen.getByTestId("chat-message-row").getAttribute("data-reactions") ?? ""
  );
}

async function tapReact() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "React m1" }));
  });
}

async function mountRoom(messages: ChatRoomMessage[] = [message("m1")]) {
  render(<RoomsClient {...baseProps} messages={messages} />);
  await act(async () => {});
}

describe("RoomsClient pending reactions", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    vi.clearAllMocks();
    fetchRoomMessagesMock
      .mockReset()
      .mockResolvedValue({ messages: [], nextCursor: null });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
  });

  it("shows the viewer's reaction and name before the server answers", async () => {
    const requests = deferReactionRequests();
    await mountRoom([message("m1", [BOB_THUMBS])]);

    await tapReact();

    expect(reactionsShown()).toBe("👍 2 me Bob,Ada");
    expect(requests.calls()).toEqual([
      { messageId: "m1", emoji: "👍", reacted: true },
    ]);

    await requests.settle(
      0,
      confirmed([
        {
          ...BOB_THUMBS,
          count: 2,
          reactedByCurrentUser: true,
          reactors: [...BOB_THUMBS.reactors, { id: "user-1", name: "Ada" }],
        },
      ]),
    );
    expect(reactionsShown()).toBe("👍 2 me Bob,Ada");
  });

  it("snaps back and toasts when the request fails", async () => {
    const requests = deferReactionRequests();
    await mountRoom();

    await tapReact();
    expect(reactionsShown()).toBe("👍 1 me Ada");

    await requests.settle(0, {
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not update reaction.",
      },
    });

    expect(reactionsShown()).toBe("");
    expect(toast.error).toHaveBeenCalledWith("Could not update reaction.");
  });

  it("sends only the newest intent after the running request returns", async () => {
    const requests = deferReactionRequests();
    await mountRoom();

    await tapReact();
    await tapReact();
    await tapReact();

    expect(reactionsShown()).toBe("👍 1 me Ada");
    expect(requests.calls()).toEqual([
      { messageId: "m1", emoji: "👍", reacted: true },
    ]);

    await requests.settle(
      0,
      confirmed([
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [{ id: "user-1", name: "Ada" }],
        },
      ]),
    );
    // On, off, on: the server already has "on", so nothing more goes out.
    expect(requests.calls()).toHaveLength(1);
    expect(reactionsShown()).toBe("👍 1 me Ada");
  });

  it("sends the opposite intent once when a tap reverses a pending one", async () => {
    const requests = deferReactionRequests();
    await mountRoom();

    await tapReact();
    await tapReact();
    expect(reactionsShown()).toBe("");

    await requests.settle(
      0,
      confirmed([
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [{ id: "user-1", name: "Ada" }],
        },
      ]),
    );
    expect(requests.calls()).toEqual([
      { messageId: "m1", emoji: "👍", reacted: true },
      { messageId: "m1", emoji: "👍", reacted: false },
    ]);
    // Still shown removed while the second request is out.
    expect(reactionsShown()).toBe("");

    await requests.settle(1, confirmed([]));
    expect(reactionsShown()).toBe("");
  });

  it("keeps the pending reaction on top of a live update", async () => {
    const requests = deferReactionRequests();
    await mountRoom();
    await tapReact();

    const event = chatRoomMessageEventDataSchema.parse({
      eventType: "reaction",
      messageId: "m1",
      roomId: "room-channel",
      parentMessageId: null,
      patch: {
        reactions: [
          {
            emoji: "❤️",
            count: 1,
            reactedByCurrentUser: false,
            reactors: [{ id: "user-2", name: "Bob" }],
          },
        ],
      },
    });
    const options = vi.mocked(useChatRoomRealtime).mock.calls.at(-1)?.[0];
    await act(async () => {
      options?.onMessage?.(event);
    });

    expect(reactionsShown()).toBe("❤️ 1 - Bob|👍 1 me Ada");

    await requests.settle(0, {
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not update reaction.",
      },
    });
    expect(reactionsShown()).toBe("❤️ 1 - Bob");
  });
});
