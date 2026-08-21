import { act, render, screen } from "@testing-library/react";

import userEvent from "@testing-library/user-event";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
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
  usePathname: () => "/chat/rooms/room-channel",
  useSearchParams: () => new URLSearchParams(),
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
    <div data-testid="chat-message-row">{message.content}</div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => <aside data-testid="thread-panel" />,
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

vi.mock("../create-channel-dialog", () => ({
  CreateChannelDialog: () => null,
}));

vi.mock("../draft-direct-message", () => ({
  DraftDirectMessage: () => null,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => <div data-testid="edit-channel-dialog-probe" />,
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

function participant(
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
      participant("user-1", "Ada"),
      participant("user-2", "Bob"),
      participant("user-3", "Cara"),
    ],
    coworkerMembers: [],
  };
}

function humanDirectRoom(): ChatRoom {
  return {
    ...channelRoom(),
    id: "room-direct",
    name: "Ada, Bob",
    slug: "direct",
    kind: "direct",
    userMembers: [participant("user-1", "Ada"), participant("user-2", "Bob")],
  };
}

function groupDirectRoom(): ChatRoom {
  return {
    ...humanDirectRoom(),
    id: "room-group",
    name: "Ada, Bob, Cara",
    userMembers: [
      participant("user-1", "Ada"),
      participant("user-2", "Bob"),
      participant("user-3", "Cara"),
    ],
  };
}

const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
} as Organization;

function renderRoom(room: ChatRoom) {
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

describe("RoomsClient room header chrome", () => {
  it("keeps search with the title and paints the title as the landmark", () => {
    renderRoom(channelRoom());

    const title = screen.getByTestId("room-open-title");
    const search = screen.getByTestId("room-search-trigger");
    const threads = screen.getByTestId("unread-threads-trigger");

    expect(title).toHaveClass("text-foreground");
    expect(title).not.toHaveClass("text-muted-foreground");
    expect(title.parentElement).toContainElement(search);
    expect(title.parentElement).not.toContainElement(threads);
  });

  it("opens the Members rail from the face stack and yields the rail to threads", async () => {
    const user = userEvent.setup();
    renderRoom(channelRoom());

    const trigger = await screen.findByTestId("room-roster-trigger");
    await user.click(trigger);
    expect(screen.getByTestId("room-roster-panel")).toBeTruthy();

    await user.click(screen.getByTestId("unread-threads-trigger"));
    expect(screen.queryByTestId("room-roster-panel")).toBeNull();
    expect(screen.getByTestId("thread-list-panel")).toBeTruthy();

    await user.click(trigger);
    expect(screen.queryByTestId("thread-list-panel")).toBeNull();
    expect(screen.getByTestId("room-roster-panel")).toBeTruthy();
  });

  it("hides the roster control on human 1:1 directs", async () => {
    renderRoom(humanDirectRoom());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("room-roster-trigger")).toBeNull();
    expect(screen.queryByTestId("edit-channel-dialog-probe")).toBeNull();
  });

  it("shows the roster control on group directs without channel settings", async () => {
    renderRoom(groupDirectRoom());
    expect(await screen.findByTestId("room-roster-trigger")).toBeTruthy();
    expect(screen.queryByTestId("edit-channel-dialog-probe")).toBeNull();
  });
});
