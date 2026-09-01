import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import {
  forgetRoomRead,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import type {
  ChatRoom,
  ChatRoomMessage,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";
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
  rememberRoomRead: vi.fn(),
  forgetRoomRead: vi.fn(),
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

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({
    membersLoadFailed,
    members,
    coworkers,
    children,
  }: {
    membersLoadFailed?: boolean;
    members?: unknown[];
    coworkers?: unknown[];
    children?: ReactNode;
  }) => (
    <>
      {children}
      <div
        data-testid="edit-channel-dialog-probe"
        data-members-load-failed={String(Boolean(membersLoadFailed))}
        data-members-count={String(members?.length ?? 0)}
        data-coworkers-count={String(coworkers?.length ?? 0)}
      />
    </>
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
  messageLoadFailed: false,
  membersLoadFailed: false,
  messages: [] as ChatRoomMessage[],
  messagesNextCursor: null as string | null,
};

describe("RoomsClient progressive history (real composer + list skeleton)", () => {
  beforeEach(() => {
    vi.mocked(markOrganizationChatRoomReadAction).mockReset();
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: {
          ...channelRoom(),
          id: roomId,
          unreadCount: 0,
          unreadMentionCount: 0,
          markedUnread: false,
        },
      }),
    );
    vi.mocked(rememberRoomRead).mockClear();
    vi.mocked(forgetRoomRead).mockClear();
  });

  it("does not advance Room last-read while history is still pending", () => {
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);

    render(
      <RoomsClient
        {...baseProps}
        rooms={[{ ...channelRoom(), unreadCount: 4 }]}
        messagesPromise={messagesPromise}
      />,
    );

    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    expect(rememberRoomRead).not.toHaveBeenCalled();
  });

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
    expect(rememberRoomRead).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "room-channel",
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("remembers local Room last-read before mark-read returns", async () => {
    let resolveRead!: (result: { ok: true; value: ChatRoom }) => void;
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

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

    render(
      <RoomsClient
        {...baseProps}
        rooms={[{ ...channelRoom(), unreadCount: 4, unreadMentionCount: 1 }]}
        messagesPromise={messagesPromise}
      />,
    );

    await act(async () => {
      resolvePage({
        messages: [sampleMessage("hydrated history body")],
        nextCursor: null,
        failed: false,
      });
      await messagesPromise;
    });

    await waitFor(() => {
      expect(rememberRoomRead).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "room-channel",
          unreadCount: 0,
          unreadMentionCount: 0,
          markedUnread: false,
        }),
      );
    });
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
    expect(rememberRoomRead).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "room-channel",
        unreadCount: 0,
      }),
    );

    await act(async () => {
      resolveRead({
        ok: true,
        value: {
          ...channelRoom(),
          unreadCount: 2,
          unreadMentionCount: 0,
          markedUnread: false,
        },
      });
    });

    expect(rememberRoomRead).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "room-channel",
        unreadCount: 2,
      }),
    );
  });

  it("advances Room last-read when history resolves empty", async () => {
    render(<RoomsClient {...baseProps} messages={[]} />);

    await waitFor(() => {
      expect(rememberRoomRead).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "room-channel",
          unreadCount: 0,
          unreadMentionCount: 0,
          markedUnread: false,
        }),
      );
    });
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("forgets local Room last-read when mark-read fails", async () => {
    vi.mocked(markOrganizationChatRoomReadAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "fail" },
    });

    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);

    await waitFor(() => {
      expect(forgetRoomRead).toHaveBeenCalledWith("room-channel");
    });
    expect(rememberRoomRead).toHaveBeenCalled();
  });

  it("restores unread when mark-read transport rejects", async () => {
    vi.mocked(markOrganizationChatRoomReadAction).mockRejectedValue(
      new Error("network"),
    );

    render(
      <RoomsClient
        {...baseProps}
        rooms={[{ ...channelRoom(), unreadCount: 4 }]}
        messages={[sampleMessage()]}
      />,
    );

    await waitFor(() => {
      expect(forgetRoomRead).toHaveBeenCalledWith("room-channel");
    });
  });

  it("restores unread after mark-read fails even if the room unmounted", async () => {
    let resolveRead!: (result: {
      ok: false;
      error: { code: string; message: string };
    }) => void;
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const unreadRoom = {
      ...channelRoom(),
      unreadCount: 4,
      unreadMentionCount: 1,
    };
    const { unmount } = render(
      <RoomsClient
        {...baseProps}
        rooms={[unreadRoom]}
        messages={[sampleMessage()]}
      />,
    );

    await waitFor(() => {
      expect(rememberRoomRead).toHaveBeenCalled();
    });
    dispatchSpy.mockClear();
    unmount();

    await act(async () => {
      resolveRead({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "fail" },
      });
    });

    expect(forgetRoomRead).toHaveBeenCalledWith("room-channel");
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "organization-chat-room-read",
        detail: expect.objectContaining({
          roomId: "room-channel",
          room: expect.objectContaining({
            id: "room-channel",
            unreadCount: 4,
            unreadMentionCount: 1,
          }),
        }),
      }),
    );
    dispatchSpy.mockRestore();
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
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    expect(rememberRoomRead).not.toHaveBeenCalled();
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
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    expect(rememberRoomRead).not.toHaveBeenCalled();
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

describe("RoomsClient progressive roster (header + composer without members)", () => {
  beforeEach(() => {
    mockIsMobileMedia.mockReturnValue(false);
    mockHeaderRoomSlotHost.mockReturnValue(null);
  });

  it("paints room title and composer while rosterPromise is pending", () => {
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);
    const rosterPromise = new Promise<RoomShellRosterPage>(() => undefined);

    render(
      <RoomsClient
        {...baseProps}
        messagesPromise={messagesPromise}
        rosterPromise={rosterPromise}
      />,
    );

    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    const probe = screen.getByTestId("edit-channel-dialog-probe");
    expect(probe).toHaveAttribute("data-members-load-failed", "false");
    expect(probe).toHaveAttribute("data-members-count", "0");
    expect(probe).toHaveAttribute("data-coworkers-count", "0");
  });

  it("paints getRoom title with composer before mobile portal/media is ready", () => {
    mockIsMobileMedia.mockReturnValue(undefined);
    mockHeaderRoomSlotHost.mockReturnValue(null);

    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);
    const rosterPromise = new Promise<RoomShellRosterPage>(() => undefined);

    render(
      <RoomsClient
        {...baseProps}
        messagesPromise={messagesPromise}
        rosterPromise={rosterPromise}
      />,
    );

    // Title must not wait on isMobile===true portal, roster, or avatars.
    expect(screen.getByTestId("room-open-title")).toHaveTextContent("general");
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
  });

  it("shows getRoom title with composer when portal host exists (never blank header)", async () => {
    mockIsMobileMedia.mockReturnValue(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHeaderRoomSlotHost.mockReturnValue(host);

    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);
    const rosterPromise = new Promise<RoomShellRosterPage>(() => undefined);

    render(
      <RoomsClient
        {...baseProps}
        messagesPromise={messagesPromise}
        rosterPromise={rosterPromise}
      />,
    );

    // Portal flips in useEffect; title must still be present with composer
    // (in-column first, then portaled) — never back-chevron-only blank header.
    expect(screen.getByTestId("room-open-title")).toHaveTextContent("general");
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
    await waitFor(() => {
      expect(
        host.querySelector("[data-testid='room-open-title']"),
      ).toHaveTextContent("general");
    });

    document.body.removeChild(host);
  });

  it("hydrates roster into the same instance without remounting composer", async () => {
    const hydratedMember: Member = {
      id: "member-1",
      organizationId: "org-1",
      role: MemberRole.MEMBER,
      seatAssignedAt: null,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      user: {
        id: "user-2",
        name: "Bob",
        email: "bob@example.com",
        image: null,
      },
      lastSeenAt: null,
    };
    const hydratedCoworker: Coworker = {
      id: "coworker-1",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      priority: 0,
      slug: "agent",
      name: "Agent",
      vendor: {
        id: "vendor-1",
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        name: "Vendor",
        slug: "vendor",
        logos: { light: null, dark: null },
      },
      baseURL: null,
      capabilities: ["chat"],
      image: null,
      metadata: null,
    };

    let resolveRoster!: (page: RoomShellRosterPage) => void;
    const rosterPromise = new Promise<RoomShellRosterPage>((resolve) => {
      resolveRoster = resolve;
    });
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);

    render(
      <RoomsClient
        {...baseProps}
        messagesPromise={messagesPromise}
        rosterPromise={rosterPromise}
      />,
    );

    const composer = screen.getByTestId("room-session-composer");
    expect(screen.getByText("general")).toBeTruthy();

    await act(async () => {
      resolveRoster({
        organizationMembers: [hydratedMember],
        membersLoadFailed: true,
        coworkers: [hydratedCoworker],
        personalAssistant: null,
      });
      await rosterPromise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("edit-channel-dialog-probe")).toHaveAttribute(
        "data-members-load-failed",
        "true",
      );
    });
    const probe = screen.getByTestId("edit-channel-dialog-probe");
    expect(probe).toHaveAttribute("data-members-count", "1");
    expect(probe).toHaveAttribute("data-coworkers-count", "1");
    expect(screen.getByTestId("room-session-composer")).toBe(composer);
    expect(screen.getByText("general")).toBeTruthy();
  });
});
