import { type RenderOptions, render } from "@testing-library/react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { beforeEach, type Mock, vi } from "vitest";
import type {
  ChatRoom,
  ChatRoomMessage,
  Organization,
} from "@/lib/clients/generated/core";

import { RoomsClient } from "../rooms-client";

/**
 * Shared RoomsClient test wiring. Mocks that every `rooms-client-*.tsx` file
 * used to copy live here. A file that needs a different stub (composer, row,
 * thread panel, search) keeps that `vi.mock` next to the cases it serves.
 */
const {
  mockIsMobileMedia,
  mockHeaderRoomSlotHost,
  mockSearch,
  mockSearchParams,
  mockPathname,
  mockReplace,
  mockStreamMessages,
  sendStreamMessage,
  useChatRoomRealtimeMock,
  countUnreadThreadsAction,
  deleteRoomMessageAction,
  editRoomMessageAction,
  getRoomThreadAction,
  listPinnedMessagesAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markThreadReadAction,
  pinRoomMessageAction,
  retryRoomMentionAction,
  sendRoomMessageAction,
  setMessageReactionAction,
  unpinRoomMessageAction,
  markOrganizationChatRoomReadAction,
  toast,
} = vi.hoisted(() => {
  const mockSearch = { current: "" };
  return {
    mockIsMobileMedia: vi.fn((): boolean | undefined => false),
    mockHeaderRoomSlotHost: vi.fn((): HTMLElement | null => null),
    mockSearch,
    mockSearchParams: vi.fn(() => new URLSearchParams(mockSearch.current)),
    mockPathname: vi.fn(() => "/chat/rooms/room-channel"),
    mockReplace: vi.fn(),
    mockStreamMessages: vi.fn((): ChatRoomMessage[] => []),
    sendStreamMessage: vi.fn((): boolean => true),
    useChatRoomRealtimeMock: vi.fn(),
    countUnreadThreadsAction: vi.fn(async () => ({
      ok: true as const,
      value: 0,
    })) as Mock,
    deleteRoomMessageAction: vi.fn() as Mock,
    editRoomMessageAction: vi.fn() as Mock,
    getRoomThreadAction: vi.fn() as Mock,
    listPinnedMessagesAction: vi.fn(async () => ({
      ok: true as const,
      value: { items: [], nextCursor: null, total: 0 },
    })) as Mock,
    listRoomMessagesAction: vi.fn(async () => ({
      ok: true as const,
      value: { messages: [] as ChatRoomMessage[], nextCursor: null },
    })) as Mock,
    listThreadMessagesAction: vi.fn(async () => ({
      ok: true as const,
      value: { messages: [] as ChatRoomMessage[], nextCursor: null },
    })) as Mock,
    markThreadReadAction: vi.fn() as Mock,
    pinRoomMessageAction: vi.fn() as Mock,
    retryRoomMentionAction: vi.fn() as Mock,
    sendRoomMessageAction: vi.fn() as Mock,
    setMessageReactionAction: vi.fn() as Mock,
    unpinRoomMessageAction: vi.fn() as Mock,
    markOrganizationChatRoomReadAction: vi.fn(async (roomId: string) => ({
      ok: true as const,
      value: {
        id: roomId,
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      },
    })) as Mock,
    toast: { error: vi.fn(), success: vi.fn() },
  };
});

export {
  countUnreadThreadsAction,
  deleteRoomMessageAction,
  editRoomMessageAction,
  getRoomThreadAction,
  listPinnedMessagesAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markOrganizationChatRoomReadAction,
  markThreadReadAction,
  mockHeaderRoomSlotHost,
  mockIsMobileMedia,
  mockPathname,
  mockReplace,
  mockSearch,
  mockSearchParams,
  mockStreamMessages,
  pinRoomMessageAction,
  retryRoomMentionAction,
  sendRoomMessageAction,
  sendStreamMessage,
  setMessageReactionAction,
  toast,
  unpinRoomMessageAction,
  useChatRoomRealtimeMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return {
    useTranslations: () => translate,
    useLocale: () => "en",
    useFormatter: () => ({
      relativeTime: (date: Date) => date.toISOString(),
    }),
  };
});

vi.mock("@/app/chat/components/day-separator", () => ({
  default: () => null,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
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
  useChatRoomRealtime: useChatRoomRealtimeMock,
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
    streamOverlayMessages: mockStreamMessages(),
    isStreaming: false,
    activeStreamParentMessageId: null,
    sendStreamMessage,
    consumePendingStreamMessage: vi.fn(),
  }),
}));

vi.mock("@/app/chat/actions", () => ({
  countUnreadThreadsAction,
  deleteRoomMessageAction,
  editRoomMessageAction,
  getRoomThreadAction,
  listPinnedMessagesAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markThreadReadAction,
  pinRoomMessageAction,
  retryRoomMentionAction,
  sendRoomMessageAction,
  setMessageReactionAction,
  unpinRoomMessageAction,
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomReadAction,
}));

vi.mock("../chat-participant-hover-card", () => ({
  ChatParticipantHoverCard: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/chat/channel-discoverability-icon", () => ({
  ChannelDiscoverabilityIcon: () => (
    <span data-testid="channel-discoverability-icon" />
  ),
}));

vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => null,
  LiveMemberPresenceText: () => null,
}));

vi.mock("sonner", () => ({
  toast,
}));

export function userParticipant(
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

export function coworkerParticipant(
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

export function channelRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-channel",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
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
    userMembers: [userParticipant("user-1", "Ada")],
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  };
}

export function sampleMessage(
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
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
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

export const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
} as Organization;

export type RoomsClientProps = ComponentProps<typeof RoomsClient>;

export function roomsClientBaseProps(
  overrides: Partial<RoomsClientProps> = {},
): RoomsClientProps {
  return {
    activeOrganization: organization,
    rooms: [channelRoom()],
    organizationMembers: [],
    currentUserId: "user-1",
    coworkers: [],
    selectedRoomId: "room-channel",
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [],
    messagesNextCursor: null,
    ...overrides,
  };
}

export function resetRoomsClientMocks() {
  mockSearch.current = "";
  mockIsMobileMedia.mockReset();
  mockIsMobileMedia.mockReturnValue(false);
  mockHeaderRoomSlotHost.mockReset();
  mockHeaderRoomSlotHost.mockReturnValue(null);
  mockSearchParams.mockReset();
  mockSearchParams.mockImplementation(
    () => new URLSearchParams(mockSearch.current),
  );
  mockPathname.mockReset();
  mockPathname.mockImplementation(() => "/chat/rooms/room-channel");
  mockReplace.mockReset();
  mockStreamMessages.mockReset();
  mockStreamMessages.mockReturnValue([]);
  sendStreamMessage.mockReset();
  sendStreamMessage.mockReturnValue(true);
  useChatRoomRealtimeMock.mockReset();
}

beforeEach(() => {
  resetRoomsClientMocks();
});

export function createRoomsClient(
  overrides?: Partial<RoomsClientProps>,
): ReactElement {
  return <RoomsClient {...roomsClientBaseProps(overrides)} />;
}

export function renderRoomsClient(
  overrides?: Partial<RoomsClientProps>,
  options?: Omit<RenderOptions, "wrapper"> & {
    wrapper?: RenderOptions["wrapper"];
  },
) {
  return render(createRoomsClient(overrides), options);
}
