import { act, render, screen, waitFor } from "@testing-library/react";

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

vi.mock("@/app/chat/actions", () => ({
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
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
  EditChannelDialog: ({ children }: { children?: ReactNode }) => (
    <>
      {children}
      <div data-testid="edit-channel-dialog-probe" />
    </>
  ),
}));

vi.mock("@/components/chat/channel-discoverability-icon", () => ({
  ChannelDiscoverabilityIcon: () => (
    <span data-testid="channel-discoverability-icon" />
  ),
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

function roomClientProps(room: ChatRoom) {
  return {
    activeOrganization: organization,
    rooms: [room],
    organizationMembers: [] as [],
    currentUserId: "user-1",
    coworkers: [] as [],
    selectedRoomId: room.id,
    isCreateChannelRequested: false,
    isNewDirectMessage: false,
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [] as [],
    messagesNextCursor: null,
  };
}

function renderRoom(room: ChatRoom) {
  return render(<RoomsClient {...roomClientProps(room)} />);
}

describe("RoomsClient room header chrome", () => {
  it("makes the channel title the settings trigger and keeps search with the right actions", () => {
    renderRoom(channelRoom());

    const title = screen.getByTestId("room-open-title");
    const search = screen.getByTestId("room-search-trigger");
    const threads = screen.getByTestId("unread-threads-trigger");

    expect(title.tagName).toBe("BUTTON");
    expect(title).toHaveAttribute("title", "editChannel");
    expect(title).toHaveAccessibleName("general");
    expect(title).toContainElement(
      screen.getByTestId("channel-discoverability-icon"),
    );
    expect(title).toHaveClass("text-foreground");
    expect(title.className).toContain("[@media(hover:hover)]:hover:bg-");
    expect(title.className).toContain("focus-visible:ring-inset");
    expect(search.parentElement).toContainElement(threads);
    expect(title.parentElement).not.toContainElement(search);
    expect(screen.getByRole("button", { name: "general" })).toBe(title);
    expect(screen.getByTestId("edit-channel-dialog-probe")).toBeTruthy();
    expect(screen.queryByTestId("room-open-topic")).toBeNull();
  });

  it("shows a Channel topic beside the title, not inside the edit trigger", () => {
    renderRoom({ ...channelRoom(), topic: "Weekly launch planning" });

    const title = screen.getByTestId("room-open-title");
    const topic = screen.getByTestId("room-open-topic");

    expect(topic).toHaveTextContent("Weekly launch planning");
    expect(title).not.toContainElement(topic);
    expect(title).toHaveAccessibleName("general");
    expect(title).toHaveAttribute("title", "editChannel");
    expect(topic).toHaveAttribute("title", "Weekly launch planning");
    expect(title.parentElement).toContainElement(topic);
    expect(title).toHaveClass("shrink-0");
    expect(topic).not.toHaveClass("hidden");
    expect(topic).toHaveClass("min-w-0");
    expect(topic.tagName).not.toBe("BUTTON");
    expect(
      screen.queryByRole("button", { name: "Weekly launch planning" }),
    ).toBeNull();
  });

  it("keeps the Channel name as identity when a topic is present", () => {
    renderRoom({
      ...channelRoom(),
      name: "Everyone",
      topic: "General discussions & updates",
    });

    const title = screen.getByTestId("room-open-title");
    const topic = screen.getByTestId("room-open-topic");

    expect(title).toHaveAccessibleName("Everyone");
    expect(title).toHaveClass("shrink-0");
    expect(topic.className.split(/\s+/)).not.toContain("min-w-16");
    expect(topic).toHaveClass("min-w-0");
  });

  it("trims a Channel topic for display", () => {
    renderRoom({ ...channelRoom(), topic: "  Weekly launch planning  " });

    const topic = screen.getByTestId("room-open-topic");
    expect(topic).toHaveTextContent("Weekly launch planning");
    expect(topic).toHaveAttribute("title", "Weekly launch planning");
  });

  it("hides a blank Channel topic", () => {
    renderRoom({ ...channelRoom(), topic: "   " });

    expect(screen.queryByTestId("room-open-topic")).toBeNull();
    expect(screen.getByTestId("room-open-title")).toHaveAccessibleName(
      "general",
    );
  });

  it("does not show a topic on Directs", () => {
    renderRoom({ ...humanDirectRoom(), topic: "Should stay hidden" });

    expect(screen.queryByTestId("room-open-topic")).toBeNull();
    expect(screen.getByTestId("room-open-title").tagName).not.toBe("BUTTON");
  });

  it("keeps Direct titles static and still puts search with the right actions", () => {
    renderRoom(humanDirectRoom());

    const title = screen.getByTestId("room-open-title");
    const search = screen.getByTestId("room-search-trigger");
    const threads = screen.getByTestId("unread-threads-trigger");

    expect(title.tagName).not.toBe("BUTTON");
    expect(search.parentElement).toContainElement(threads);
    expect(screen.queryByRole("button", { name: "editChannel" })).toBeNull();
    expect(screen.queryByTestId("edit-channel-dialog-probe")).toBeNull();
  });

  it("opens the Members rail from the face stack and yields the rail to threads", async () => {
    const user = userEvent.setup();
    renderRoom(channelRoom());

    const trigger = await screen.findByTestId("room-roster-trigger");
    expect(trigger).toHaveAttribute("aria-controls", "room-roster-panel");
    expect(trigger).toHaveAttribute("title", "RoomRoster.open");
    await user.click(trigger);
    expect(screen.getByTestId("room-roster-panel")).toHaveAttribute(
      "id",
      "room-roster-panel",
    );

    await user.click(screen.getByTestId("unread-threads-trigger"));
    expect(screen.queryByTestId("room-roster-panel")).toBeNull();
    expect(screen.getByTestId("thread-list-panel")).toBeTruthy();

    await user.click(trigger);
    expect(screen.queryByTestId("thread-list-panel")).toBeNull();
    expect(screen.getByTestId("room-roster-panel")).toBeTruthy();
  });

  it("hides the roster control on human 1:1 directs", async () => {
    renderRoom(humanDirectRoom());
    await screen.findByTestId("unread-threads-trigger");
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("room-roster-trigger")).toBeNull();
    expect(screen.queryByTestId("edit-channel-dialog-probe")).toBeNull();
  });

  it("closes the Members rail when a group Direct shrinks to 1:1", async () => {
    const user = userEvent.setup();
    const group = groupDirectRoom();
    const { rerender } = renderRoom(group);

    const trigger = await screen.findByTestId("room-roster-trigger");
    await user.click(trigger);
    expect(screen.getByTestId("room-roster-panel")).toBeTruthy();

    const pair: ChatRoom = {
      ...group,
      userMembers: group.userMembers.slice(0, 2),
    };
    rerender(<RoomsClient {...roomClientProps(pair)} />);

    await waitFor(() => {
      expect(screen.queryByTestId("room-roster-panel")).toBeNull();
      expect(screen.queryByTestId("room-roster-trigger")).toBeNull();
    });
  });

  it("shows the roster control on group directs without channel settings", async () => {
    renderRoom(groupDirectRoom());
    expect(await screen.findByTestId("room-roster-trigger")).toBeTruthy();
    expect(screen.queryByTestId("edit-channel-dialog-probe")).toBeNull();
  });
});
