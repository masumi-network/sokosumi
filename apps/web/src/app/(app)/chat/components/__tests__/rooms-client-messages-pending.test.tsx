import { act, render, screen, waitFor } from "@testing-library/react";
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

function sampleMessage(content = "history body"): ChatRoomMessage {
  return {
    id: "msg-real",
    roomId: "room-channel",
    parentMessageId: null,
    content,
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
  messages: [] as ChatRoomMessage[],
  messagesNextCursor: null as string | null,
};

describe("RoomsClient progressive history (real composer + list skeleton)", () => {
  it("shows list skeleton and real composer while history is pending", () => {
    // Intentionally never settles — pending shell only.
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);

    render(<RoomsClient {...baseProps} messagesPromise={messagesPromise} />);

    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("chat-message-row")).toBeNull();
    // Real composer mounts with shell (not a fake Instant composer skeleton).
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-focus-on-mount",
      "false",
    );
  });

  it("hydrates history into the same instance and enables composer focus", async () => {
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

    render(<RoomsClient {...baseProps} messagesPromise={messagesPromise} />);

    const composer = screen.getByTestId("room-session-composer");

    await act(async () => {
      resolvePage({
        messages: [sampleMessage("hydrated history body")],
        nextCursor: null,
        failed: false,
      });
      await messagesPromise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "hydrated history body",
    );
    expect(screen.getByTestId("room-session-composer")).toBe(composer);
    expect(composer).toHaveAttribute("data-focus-on-mount", "true");
  });

  it("shows load-failed empty state when deferred history fails", async () => {
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

    render(<RoomsClient {...baseProps} messagesPromise={messagesPromise} />);

    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    const composer = screen.getByTestId("room-session-composer");

    await act(async () => {
      resolvePage({
        messages: [],
        nextCursor: null,
        failed: true,
      });
      await messagesPromise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByText("Empty.messagesLoadFailedTitle")).toBeTruthy();
    expect(screen.queryByTestId("chat-message-row")).toBeNull();
    expect(screen.getByTestId("room-session-composer")).toBe(composer);
  });

  it("settles to load-failed when deferred history promise rejects", async () => {
    let rejectPage!: (reason?: unknown) => void;
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((_resolve, reject) => {
      rejectPage = reject;
    });

    render(<RoomsClient {...baseProps} messagesPromise={messagesPromise} />);

    await act(async () => {
      rejectPage(new Error("network boom"));
      await messagesPromise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByText("Empty.messagesLoadFailedTitle")).toBeTruthy();
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
  });

  it("clears prior room messages when progressive room switches", async () => {
    let resolveA!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    let resolveB!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const promiseA = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolveB = resolve;
    });

    const roomA = channelRoom();
    const roomB: ChatRoom = {
      ...channelRoom(),
      id: "room-other",
      name: "other",
      slug: "other",
    };

    const { rerender } = render(
      <RoomsClient
        {...baseProps}
        rooms={[roomA]}
        selectedRoomId={roomA.id}
        messagesPromise={promiseA}
      />,
    );

    await act(async () => {
      resolveA({
        messages: [sampleMessage("from room A")],
        nextCursor: null,
        failed: false,
      });
      await promiseA;
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
        "from room A",
      );
    });

    rerender(
      <RoomsClient
        {...baseProps}
        rooms={[roomA, roomB]}
        selectedRoomId={roomB.id}
        messagesPromise={promiseB}
      />,
    );

    expect(screen.queryByText("from room A")).toBeNull();
    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();

    await act(async () => {
      resolveB({
        messages: [
          {
            ...sampleMessage("from room B"),
            id: "msg-b",
            roomId: roomB.id,
          },
        ],
        nextCursor: null,
        failed: false,
      });
      await promiseB;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.queryByText("from room A")).toBeNull();
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "from room B",
    );
  });

  it("does not re-enter pending or flip focus on same-room promise swap", async () => {
    let resolveA!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const promiseA = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolveA = resolve;
    });

    const { rerender } = render(
      <RoomsClient {...baseProps} messagesPromise={promiseA} />,
    );

    await act(async () => {
      resolveA({
        messages: [sampleMessage("stable history")],
        nextCursor: null,
        failed: false,
      });
      await promiseA;
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
        "stable history",
      );
    });
    const composer = screen.getByTestId("room-session-composer");
    expect(composer).toHaveAttribute("data-focus-on-mount", "true");

    let resolveB!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const promiseB = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolveB = resolve;
    });

    // RSC refresh: new promise, same room — must not show skeleton / defocus.
    rerender(<RoomsClient {...baseProps} messagesPromise={promiseB} />);

    expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "stable history",
    );
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-focus-on-mount",
      "true",
    );

    await act(async () => {
      resolveB({
        messages: [
          {
            ...sampleMessage("refreshed page"),
            id: "msg-refresh",
          },
        ],
        nextCursor: null,
        failed: false,
      });
      await promiseB;
    });

    await waitFor(() => {
      expect(screen.getByText("refreshed page")).toBeTruthy();
    });
    expect(screen.getByText("stable history")).toBeTruthy();
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-focus-on-mount",
      "true",
    );
  });
});
