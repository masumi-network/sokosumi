import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";

const actions = vi.hoisted(() => ({
  markThreadReadAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
  markOrganizationChatRoomReadAction: vi.fn(),
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
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: actions.listThreadMessagesAction,
  markThreadReadAction: actions.markThreadReadAction,
  sendRoomMessageAction: vi.fn(),
  toggleMessageReactionAction: vi.fn(),
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomReadAction:
    actions.markOrganizationChatRoomReadAction,
}));

vi.mock("@/components/chat/room-read-overlay", () => ({
  applyRoomReadResultToOverlay: vi.fn(),
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
      clearKeepingFocus: () => undefined,
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
      onClick={() => onOpenThread?.(message)}
    >
      {message.content}
    </button>
  ),
}));

/** Capture loading/replies so the race is asserted at the real seam. */
vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    isLoading,
    replies,
    onClose,
  }: {
    isLoading: boolean;
    replies: ChatRoomMessage[];
    onClose: () => void;
  }) => (
    <div data-testid="thread-panel">
      <span data-testid="thread-loading">{String(isLoading)}</span>
      <span data-testid="thread-reply-count">{replies.length}</span>
      <span data-testid="thread-state">
        {isLoading ? "loading" : replies.length === 0 ? "empty" : "replies"}
      </span>
      <button type="button" data-testid="thread-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("../create-channel-dialog", () => ({
  CreateChannelDialog: () => null,
}));

vi.mock("../draft-direct-message", () => ({
  DraftDirectMessage: () => null,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => null,
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
    pinnedAt: null,
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
  };
}

function parentMessage(): ChatRoomMessage {
  return {
    id: "parent-1",
    roomId: "room-channel",
    parentMessageId: null,
    content: "Parent with replies",
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 2,
    threadLastReplyAt: new Date("2026-07-01T12:02:00.000Z"),
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
  isCreateChannelRequested: false,
  isNewDirectMessage: false,
  messageLoadFailed: false,
  membersLoadFailed: false,
  messages: [parentMessage()],
  messagesNextCursor: null as string | null,
};

describe("RoomsClient thread open loading race", () => {
  beforeEach(() => {
    actions.markThreadReadAction.mockReset();
    actions.listThreadMessagesAction.mockReset();
    actions.markOrganizationChatRoomReadAction.mockReset();
    actions.markOrganizationChatRoomReadAction.mockResolvedValue({
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
    actions.markThreadReadAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    actions.listThreadMessagesAction.mockResolvedValue({
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
    expect(actions.markThreadReadAction).toHaveBeenCalled();

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

  it("invalidates in-flight load when the panel is closed mid-fetch", async () => {
    let resolveMark!: (value: {
      ok: true;
      value: { lookedAt: string };
    }) => void;
    actions.markThreadReadAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    actions.listThreadMessagesAction.mockResolvedValue({
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
});
