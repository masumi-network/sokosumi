import { act, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import type {
  RoomSessionSendRequest,
  RoomSessionSendResult,
} from "../room-session-composer";
import { RoomsClient } from "../rooms-client";

const {
  pinToBottomAfterOwnSend,
  scrollToBottomIfPinned,
  sendStreamMessage,
  sendRoomMessageAction,
} = vi.hoisted(() => ({
  pinToBottomAfterOwnSend: vi.fn(),
  scrollToBottomIfPinned: vi.fn(),
  sendStreamMessage: vi.fn((): boolean => true),
  sendRoomMessageAction: vi.fn(),
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
    pinToBottomAfterOwnSend,
    scrollToBottomIfPinned,
  }),
}));

vi.mock("@/app/chat/hooks/use-coworker-direct-room-stream", () => ({
  readStoredStreamParentMessageId: () => null,
  useCoworkerDirectRoomStream: () => ({
    streamOverlayMessages: [],
    isStreaming: false,
    activeStreamParentMessageId: null,
    sendStreamMessage,
    consumePendingStreamMessage: vi.fn(),
  }),
}));

vi.mock("@/app/chat/actions", () => ({
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  sendRoomMessageAction,
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
    onChromeResize,
    onBeforeSend,
    onSend,
  }: {
    ref?: Ref<RoomComposerHandle>;
    onChromeResize?: () => void;
    onBeforeSend?: (clientMessageId: string) => boolean;
    onSend?: (
      request: RoomSessionSendRequest,
    ) => Promise<RoomSessionSendResult>;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <>
        <button
          type="button"
          data-testid="chrome-resize"
          onClick={onChromeResize}
        >
          chrome-resize
        </button>
        <button
          type="button"
          data-testid="send-message"
          onClick={() => {
            const clientMessageId = "client-msg-1";
            if (onBeforeSend && !onBeforeSend(clientMessageId)) {
              return;
            }
            void onSend?.({
              content: "hello",
              mentionedIds: [],
              clientMessageId,
            });
          }}
        >
          send-message
        </button>
      </>
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div>{message.content}</div>
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

function userParticipant(
  id: string,
  name: string,
): ChatRoom["userMembers"][number] {
  return {
    id,
    name,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
  };
}

function coworkerParticipant(
  id: string,
  name: string,
): ChatRoom["coworkerMembers"][number] {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    caption: null,
    image: null,
    presence: "online",
  };
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
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      userParticipant("user-1", "Ada"),
      userParticipant("user-2", "Bob"),
    ],
    coworkerMembers: [],
  };
}

function coworkerDirectRoom(): ChatRoom {
  return {
    id: "room-coworker",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Jamal",
    slug: "jamal",
    kind: "direct",
    directKey: "direct-key",
    topic: null,
    discoverability: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [userParticipant("user-1", "Ada")],
    coworkerMembers: [coworkerParticipant("cow-1", "Jamal")],
  };
}

function sentMessage(roomId: string): ChatRoomMessage {
  return {
    id: "msg-sent",
    roomId,
    parentMessageId: null,
    content: "hello",
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

function renderRoomsClient(room: ChatRoom) {
  return render(
    <RoomsClient
      activeOrganization={organization}
      rooms={[room]}
      organizationMembers={[]}
      currentUserId="user-1"
      coworkers={[]}
      selectedRoomId={room.id}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={false}
      membersLoadFailed={false}
      messages={[]}
      messagesNextCursor={null}
    />,
  );
}

describe("RoomsClient scroll on own send", () => {
  beforeEach(() => {
    pinToBottomAfterOwnSend.mockClear();
    scrollToBottomIfPinned.mockClear();
    sendStreamMessage.mockReset();
    sendStreamMessage.mockReturnValue(true);
    sendRoomMessageAction.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pins on successful classic channel send", async () => {
    const room = channelRoom();
    sendRoomMessageAction.mockResolvedValue({
      ok: true,
      value: sentMessage(room.id),
    });
    renderRoomsClient(room);

    await act(async () => {
      screen.getByTestId("send-message").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendRoomMessageAction).toHaveBeenCalled();
    expect(pinToBottomAfterOwnSend).toHaveBeenCalled();
  });

  it("pins when coworker stream send is accepted", async () => {
    sendStreamMessage.mockReturnValue(true);
    renderRoomsClient(coworkerDirectRoom());

    await act(async () => {
      screen.getByTestId("send-message").click();
      await Promise.resolve();
    });

    expect(sendStreamMessage).toHaveBeenCalled();
    expect(pinToBottomAfterOwnSend).toHaveBeenCalled();
  });

  it("does not pin when coworker stream send is declined", async () => {
    sendStreamMessage.mockReturnValue(false);
    renderRoomsClient(coworkerDirectRoom());

    await act(async () => {
      screen.getByTestId("send-message").click();
      await Promise.resolve();
    });

    expect(sendStreamMessage).toHaveBeenCalled();
    expect(pinToBottomAfterOwnSend).not.toHaveBeenCalled();
  });

  it("uses scrollToBottomIfPinned for chrome resize", () => {
    renderRoomsClient(channelRoom());

    act(() => {
      screen.getByTestId("chrome-resize").click();
    });

    expect(scrollToBottomIfPinned).toHaveBeenCalled();
    expect(pinToBottomAfterOwnSend).not.toHaveBeenCalled();
  });
});
