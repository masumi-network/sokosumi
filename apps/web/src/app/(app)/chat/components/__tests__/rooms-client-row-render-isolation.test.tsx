import { act, fireEvent, render, screen } from "@testing-library/react";
import { memo, type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editRoomMessageAction,
  pinRoomMessageAction,
  toggleMessageReactionAction,
  unpinRoomMessageAction,
} from "@/app/chat/actions";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably";
import { useChatRoomRealtime } from "@/lib/ably/use-chat-room-realtime";
import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

/**
 * A change that touches one message must re-render that row only. The row
 * stub is memoized, so a row re-renders exactly when RoomsClient hands it a
 * prop with a new identity or value.
 */

const { rowRenders, fetchRoomMessagesMock } = vi.hoisted(() => ({
  rowRenders: new Map<string, number>(),
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

// next-intl memoizes its translator; a fresh function per render would
// churn every memoized input that lists `t`.
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
    streamOverlayMessages: [],
    isStreaming: false,
    activeStreamParentMessageId: null,
    sendStreamMessage: vi.fn(),
    consumePendingStreamMessage: vi.fn(),
  }),
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => false,
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
  toggleMessageReactionAction: vi.fn(),
  unpinRoomMessageAction: vi.fn(),
}));

// Scheduled room recovery reads go over GET; the poll is the refresh merge.
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
  ChatMessageRow: memo(function ChatMessageRowStub({
    message,
    isPinned,
    isEditing,
    editDraft,
    onToggleReaction,
    onPin,
    onStartEdit,
    onEditDraftChange,
    onSaveEdit,
  }: {
    message: ChatRoomMessage;
    isPinned?: boolean;
    isEditing?: boolean;
    editDraft?: string;
    onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
    onPin?: (message: ChatRoomMessage) => void;
    onStartEdit?: (message: ChatRoomMessage) => void;
    onEditDraftChange?: (value: string) => void;
    onSaveEdit?: (content?: string) => void;
  }) {
    rowRenders.set(message.id, (rowRenders.get(message.id) ?? 0) + 1);
    return (
      <div
        data-testid="chat-message-row"
        data-message-id={message.id}
        data-pinned={String(Boolean(isPinned))}
        data-editing={String(Boolean(isEditing))}
        data-edit-draft={editDraft ?? ""}
      >
        {message.content}
        <button type="button" onClick={() => onToggleReaction(message, "👍")}>
          {`React ${message.id}`}
        </button>
        <button type="button" onClick={() => onPin?.(message)}>
          {`Pin ${message.id}`}
        </button>
        <button type="button" onClick={() => onStartEdit?.(message)}>
          {`Edit ${message.id}`}
        </button>
        <button
          type="button"
          onClick={() => onEditDraftChange?.("typed draft")}
        >
          {`Type ${message.id}`}
        </button>
        <button type="button" onClick={() => onSaveEdit?.()}>
          {`Save ${message.id}`}
        </button>
      </div>
    );
  }),
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

function message(id: string, minute: number): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content: `body ${id}`,
    createdAt: new Date(
      `2026-07-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
    ),
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

const messages = [message("m1", 1), message("m2", 2), message("m3", 3)];

const baseProps = {
  activeOrganization: organization,
  rooms: [channelRoom()],
  organizationMembers: [] as [],
  currentUserId: "user-1",
  coworkers: [] as [],
  selectedRoomId: "room-channel",
  messageLoadFailed: false,
  membersLoadFailed: false,
  messages,
  messagesNextCursor: null as string | null,
};

function realtimeOptions() {
  const options = vi.mocked(useChatRoomRealtime).mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error("useChatRoomRealtime was not called");
  }
  return options;
}

function snapshotRenders() {
  return new Map(rowRenders);
}

function rendersSince(before: Map<string, number>) {
  const delta: Record<string, number> = {};
  for (const [id, count] of rowRenders) {
    delta[id] = count - (before.get(id) ?? 0);
  }
  return delta;
}

async function mountRoom() {
  render(<RoomsClient {...baseProps} />);
  await act(async () => {});
  expect(screen.getAllByTestId("chat-message-row")).toHaveLength(3);
  return snapshotRenders();
}

describe("RoomsClient transcript row render isolation", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    rowRenders.clear();
    vi.clearAllMocks();
    fetchRoomMessagesMock
      .mockReset()
      .mockResolvedValue({ messages: [], nextCursor: null });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders no row when a refresh merge re-sends the same messages", async () => {
    vi.useFakeTimers();
    fetchRoomMessagesMock.mockImplementation(async () => ({
      messages: [message("m1", 1), message("m2", 2), message("m3", 3)],
      nextCursor: null,
    }));
    const before = await mountRoom();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(fetchRoomMessagesMock).toHaveBeenCalled();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 0, m3: 0 });
  });

  it("renders only the changed row when a refresh merge differs", async () => {
    vi.useFakeTimers();
    fetchRoomMessagesMock.mockImplementation(async () => ({
      messages: [
        message("m1", 1),
        { ...message("m2", 2), content: "edited elsewhere" },
        message("m3", 3),
      ],
      nextCursor: null,
    }));
    const before = await mountRoom();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(screen.getByText("edited elsewhere")).toBeTruthy();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("renders only the new row when a realtime message arrives", async () => {
    const before = await mountRoom();

    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({ eventType: "create", message: message("m4", 4) }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });

    expect(screen.getByText("body m4")).toBeTruthy();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 0, m3: 0, m4: 1 });
  });

  it("re-renders only the reacted row", async () => {
    vi.mocked(toggleMessageReactionAction).mockImplementation(
      async (_roomId, messageId, emoji) => ({
        ok: true as const,
        value: {
          ...message(messageId, 2),
          reactions: [
            { emoji, count: 1, reactedByCurrentUser: true, reactors: [] },
          ],
        },
      }),
    );
    const before = await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "React m2" }));
    });

    expect(toggleMessageReactionAction).toHaveBeenCalledWith(
      "room-channel",
      "m2",
      "👍",
    );
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("re-renders only the row entering edit mode", async () => {
    const before = await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });

    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-editing")),
    ).toEqual(["false", "true", "false"]);
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("re-renders only the edited row while its draft changes", async () => {
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });
    const before = snapshotRenders();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type m2" }));
    });

    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-edit-draft")),
    ).toEqual(["", "typed draft", ""]);
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("unpins a row that was pinned over realtime after mount", async () => {
    vi.mocked(unpinRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: undefined as never,
    });
    await mountRoom();

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "pin",
        roomId: "room-channel",
        messageId: "m2",
        pinnedMessageCount: 1,
      });
    });
    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-pinned")),
    ).toEqual(["false", "true", "false"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });

    expect(unpinRoomMessageAction).toHaveBeenCalledWith("room-channel", "m2");
    expect(pinRoomMessageAction).not.toHaveBeenCalled();
  });

  it("saves the current draft after a realtime update to the edited row", async () => {
    vi.mocked(editRoomMessageAction).mockImplementation(
      async (_roomId, messageId, content) => ({
        ok: true as const,
        value: { ...message(messageId, 2), content },
      }),
    );
    await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type m2" }));
    });
    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "update",
          message: { ...message("m2", 2), reactions: [] },
        }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save m2" }));
    });

    expect(editRoomMessageAction).toHaveBeenCalledWith(
      "room-channel",
      "m2",
      "typed draft",
    );
  });
});
