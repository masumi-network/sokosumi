import { render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";

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
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
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
  applyRoomReadResultToOverlay: vi.fn(),
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    isSending,
  }: {
    ref?: Ref<RoomComposerHandle>;
    isSending?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-sending={String(Boolean(isSending))}
      />
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row">{message.content}</div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
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

function sampleMessage(): ChatRoomMessage {
  return {
    id: "msg-real",
    roomId: "room-channel",
    parentMessageId: null,
    content: "SECRET_BODY_SHOULD_NOT_RENDER",
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

describe("RoomsClient messagesPending progressive shell", () => {
  it("shows list skeleton and hides message bodies while history is pending", () => {
    render(
      <RoomsClient
        activeOrganization={organization}
        rooms={[channelRoom()]}
        organizationMembers={[]}
        currentUserId="user-1"
        coworkers={[]}
        selectedRoomId="room-channel"
        isCreateChannelRequested={false}
        isNewDirectMessage={false}
        messageLoadFailed={false}
        membersLoadFailed={false}
        messages={[sampleMessage()]}
        messagesNextCursor={null}
        messagesPending
      />,
    );

    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("chat-message-row")).toBeNull();
    expect(screen.queryByText("SECRET_BODY_SHOULD_NOT_RENDER")).toBeNull();
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-sending",
      "true",
    );
  });

  it("renders message bodies when history is ready", () => {
    render(
      <RoomsClient
        activeOrganization={organization}
        rooms={[channelRoom()]}
        organizationMembers={[]}
        currentUserId="user-1"
        coworkers={[]}
        selectedRoomId="room-channel"
        isCreateChannelRequested={false}
        isNewDirectMessage={false}
        messageLoadFailed={false}
        membersLoadFailed={false}
        messages={[sampleMessage()]}
        messagesNextCursor={null}
        messagesPending={false}
      />,
    );

    expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "SECRET_BODY_SHOULD_NOT_RENDER",
    );
  });
});
