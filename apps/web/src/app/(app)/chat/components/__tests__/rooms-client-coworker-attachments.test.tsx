import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";
import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";

const {
  mockIsMobileMedia,
  mockHeaderRoomSlotHost,
  mockSearchParams,
  mockPathname,
  mockReplace,
} = vi.hoisted(() => ({
  mockIsMobileMedia: vi.fn((): boolean | undefined => false),
  mockHeaderRoomSlotHost: vi.fn((): HTMLElement | null => null),
  mockSearchParams: vi.fn(() => new URLSearchParams()),
  mockPathname: vi.fn(() => "/chat/rooms/room-channel"),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => (
    <button type="button" data-testid="room-search-trigger" />
  ),
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: ({
    onToggle,
    isOpen,
  }: {
    onToggle: () => void;
    isOpen: boolean;
  }) => (
    <button
      type="button"
      data-testid="unread-threads-trigger"
      aria-expanded={isOpen}
      onClick={onToggle}
    />
  ),
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
  listRoomMessagesAction: vi.fn(),
  listPinnedMessagesAction: vi.fn(async () => ({
    ok: true as const,
    value: { items: [], nextCursor: null, total: 0 },
  })),
  listThreadMessagesAction: vi.fn(async () => ({
    ok: true as const,
    value: { messages: [], nextCursor: null },
  })),
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

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({
    children,
    enabled,
  }: {
    children: ReactNode;
    enabled: boolean;
  }) => (
    <div data-testid="room-file-drop-zone" data-enabled={String(enabled)}>
      {children}
    </div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    allowAttachments,
  }: {
    ref?: Ref<RoomComposerHandle>;
    allowAttachments?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-allow-attachments={String(allowAttachments ?? true)}
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
    <button
      type="button"
      data-testid={`open-thread-${message.id}`}
      onClick={() => onOpenThread?.(message)}
    >
      {message.content}
    </button>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({ allowAttachments }: { allowAttachments?: boolean }) => (
    <aside
      data-testid="thread-panel"
      data-allow-attachments={String(allowAttachments ?? true)}
    />
  ),
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({ children }: { children?: ReactNode }) => (
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

function coworkerDirectRoom(): ChatRoom {
  return {
    id: "room-coworker",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Ada, Eve",
    slug: "direct",
    kind: "direct",
    isSelfDirect: false,
    directKey: null,
    topic: null,
    discoverability: "private",
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
    coworkerMembers: [
      {
        id: "coworker-1",
        name: "Eve",
        slug: "eve",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
    sokoBotMembers: [],
  };
}

function parentMessage(): ChatRoomMessage {
  return {
    id: "msg-parent",
    roomId: "room-coworker",
    parentMessageId: null,
    content: "hello",
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

function renderRoom(room: ChatRoom) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RoomsClient
        activeOrganization={organization}
        rooms={[room]}
        organizationMembers={[]}
        currentUserId="user-1"
        coworkers={[]}
        selectedRoomId={room.id}
        messageLoadFailed={false}
        membersLoadFailed={false}
        messages={[parentMessage()]}
        messagesNextCursor={null}
      />
    </QueryClientProvider>,
  );
}

// Regression: coworker DMs hid the attach button and drop zone, so users
// could not upload pictures when chatting with an agent.
describe("RoomsClient coworker DM attachments", () => {
  it("allows attachments and file drops in a coworker direct room", () => {
    renderRoom(coworkerDirectRoom());
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-allow-attachments",
      "true",
    );
    expect(screen.getByTestId("room-file-drop-zone")).toHaveAttribute(
      "data-enabled",
      "true",
    );
  });

  it("allows attachments in a coworker direct room thread", async () => {
    renderRoom(coworkerDirectRoom());
    fireEvent.click(screen.getByTestId("open-thread-msg-parent"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-allow-attachments",
        "true",
      );
    });
  });
});
