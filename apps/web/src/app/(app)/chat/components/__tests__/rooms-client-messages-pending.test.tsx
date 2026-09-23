import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listRoomMessagesAction,
  sendRoomMessageAction,
} from "@/app/chat/actions";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import {
  clearRoomReadOverlays,
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
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import { RoomCacheProvider } from "../room-cache-provider";
import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import { transcriptViewportSpies } from "./transcript-viewport-stub";

const {
  mockIsMobileMedia,
  mockHeaderRoomSlotHost,
  mockRoomRealtime,
  mockRouterReplace,
} = vi.hoisted(() => ({
  mockRoomRealtime: vi.fn(),
  mockIsMobileMedia: vi.fn((): boolean | undefined => false),
  mockHeaderRoomSlotHost: vi.fn((): HTMLElement | null => null),
  mockRouterReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
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
  useChatRoomRealtime: (options: unknown) => mockRoomRealtime(options),
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

vi.mock("@/app/chat/actions", () => ({
  countUnreadThreadsAction: vi.fn(async () => ({
    ok: true as const,
    value: 0,
  })),
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
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

vi.mock("@/components/chat/room-read-overlay", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/room-read-overlay")
    >();
  const rememberRoomRead = vi.fn();
  const forgetRoomRead = vi.fn();
  return {
    ...actual,
    rememberRoomRead,
    forgetRoomRead,
    beginRoomAttentionChange: (room: ChatRoom, previousRoom?: ChatRoom) => {
      rememberRoomRead(room);
      return actual.beginRoomAttentionChange(room, previousRoom);
    },
    settleRoomAttentionChange: (
      roomId: string,
      token: number,
      room: ChatRoom | null,
    ) => {
      const accepted = actual.settleRoomAttentionChange(roomId, token, room);
      if (accepted) {
        if (room) rememberRoomRead(room);
        else forgetRoomRead(roomId);
      }
      return accepted;
    },
  };
});

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    focusOnMount,
    onSend,
  }: {
    ref?: Ref<RoomComposerHandle>;
    focusOnMount?: boolean;
    onSend: (request: {
      content: string;
      attachments: [];
      mentionedIds: [];
      clientMessageId: string;
    }) => Promise<unknown>;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-focus-on-mount={String(Boolean(focusOnMount))}
      >
        <button
          onClick={() =>
            void onSend({
              content: "local outbound",
              attachments: [],
              mentionedIds: [],
              clientMessageId: crypto.randomUUID(),
            })
          }
        >
          Send fixture
        </button>
      </div>
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
    isSelfDirect: false,
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

function sampleMessage(content = "history body"): ChatRoomMessage {
  return {
    id: "msg-real",
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
    clearRoomReadOverlays();
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
    clearRoomReadOverlays();
    mockIsMobileMedia.mockReturnValue(false);
    mockHeaderRoomSlotHost.mockReturnValue(null);
  });

  it("paints room title and composer while rosterPromise is pending", () => {
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>(() => undefined);
    const rosterPromise = new Promise<{
      organizationMembers: [];
      membersLoadFailed: boolean;
      coworkers: [];
      sokoBots: [];
    }>(() => undefined);

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
    const rosterPromise = new Promise<{
      organizationMembers: [];
      membersLoadFailed: boolean;
      coworkers: [];
      sokoBots: [];
    }>(() => undefined);

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
    const rosterPromise = new Promise<{
      organizationMembers: [];
      membersLoadFailed: boolean;
      coworkers: [];
      sokoBots: [];
    }>(() => undefined);

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
        sokoBots: [],
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

function CacheWrapper({ children }: { children: ReactNode }) {
  return (
    <TestQueryProvider>
      <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
        {children}
      </RoomCacheProvider>
    </TestQueryProvider>
  );
}
function backgroundPage(
  messages: ChatRoomMessage[],
  nextCursor: string | null = null,
) {
  return new Response(
    JSON.stringify({ data: messages, meta: { pagination: { nextCursor } } }),
    { status: 200 },
  );
}
const roomBProps = {
  ...baseProps,
  selectedRoomId: "room-b",
  rooms: [{ ...channelRoom(), id: "room-b", name: "Channel B" }],
};

describe("retained channel history", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    mockRoomRealtime.mockClear();
    mockRouterReplace.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("shows retained history immediately while the returning server history is unresolved", async () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <TestQueryProvider>
          <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
            {children}
          </RoomCacheProvider>
        </TestQueryProvider>
      );
    }
    const view = render(
      <RoomsClient {...baseProps} messages={[sampleMessage("retained A")]} />,
      { wrapper: Wrapper },
    );
    expect(await screen.findByText("retained A")).toBeTruthy();
    view.rerender(
      <RoomsClient
        {...baseProps}
        selectedRoomId="room-b"
        rooms={[{ ...channelRoom(), id: "room-b", name: "Channel B" }]}
        messages={[
          { ...sampleMessage("history B"), id: "b", roomId: "room-b" },
        ]}
      />,
    );
    expect(await screen.findByText("history B")).toBeTruthy();
    view.rerender(
      <RoomsClient {...baseProps} messagesPromise={new Promise(() => {})} />,
    );
    expect(screen.getByText("retained A")).toBeTruthy();
    expect(screen.queryByText("history B")).toBeNull();
    expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
  });
});

describe("channel cache access and navigation", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    mockRoomRealtime.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("drops queued sends and pending shells when leaving their composer", async () => {
    const sent =
      Promise.withResolvers<
        Awaited<ReturnType<typeof sendRoomMessageAction>>
      >();
    vi.mocked(sendRoomMessageAction).mockReset().mockReturnValue(sent.promise);
    const view = render(
      <RoomsClient {...baseProps} messages={[sampleMessage("confirmed")]} />,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("Send fixture"));
    fireEvent.click(screen.getByText("Send fixture"));
    expect(sendRoomMessageAction).toHaveBeenCalledTimes(1);
    view.rerender(<RoomsClient {...roomBProps} />);
    await act(async () =>
      sent.resolve({ ok: true, value: sampleMessage("confirmed send") }),
    );
    expect(sendRoomMessageAction).toHaveBeenCalledTimes(1);
    view.rerender(
      <RoomsClient {...baseProps} messagesPromise={new Promise(() => {})} />,
    );
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByText("local outbound")).toBeNull();
  });

  it.each(["channel", "direct"] as const)(
    "switches cached %s rooms before server navigation finishes",
    async (kind) => {
      function Page({ bootstrap }: { bootstrap: typeof baseProps }) {
        return (
          <>
            <a
              href="/chat/rooms/room-channel"
              onClick={(event) => event.preventDefault()}
            >
              Open A
            </a>
            <a
              href="/chat/rooms/room-b"
              onClick={(event) => event.preventDefault()}
            >
              Open B
            </a>
            <PersistentRoomView>
              <RoomRouteBootstrap {...bootstrap} />
            </PersistentRoomView>
          </>
        );
      }
      const view = render(
        <Page
          bootstrap={{
            ...baseProps,
            rooms: baseProps.rooms.map((room) => ({ ...room, kind })),
            messages: [sampleMessage("A retained")],
          }}
        />,
        { wrapper: CacheWrapper },
      );
      fireEvent.click(screen.getByText("Open A"));
      expect(await screen.findByText("A retained")).toBeTruthy();
      view.rerender(
        <Page
          bootstrap={{
            ...roomBProps,
            rooms: roomBProps.rooms.map((room) => ({ ...room, kind })),
            messages: [
              { ...sampleMessage("B retained"), id: "b", roomId: "room-b" },
            ],
          }}
        />,
      );
      fireEvent.click(screen.getByText("Open B"));
      expect(await screen.findByText("B retained")).toBeTruthy();
      fireEvent.click(screen.getByText("Open A"));
      expect(screen.getByText("A retained")).toBeTruthy();
      expect(screen.queryByText("B retained")).toBeNull();
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    },
  );

  it("keeps the open room on screen until an uncached room can paint", async () => {
    render(
      <>
        <a
          href="/chat/rooms/room-channel"
          onClick={(event) => event.preventDefault()}
        >
          Open A
        </a>
        <a
          href="/chat/rooms/room-direct"
          onClick={(event) => event.preventDefault()}
        >
          Open direct
        </a>
        <PersistentRoomView>
          <RoomRouteBootstrap
            {...baseProps}
            messages={[sampleMessage("stay visible")]}
          />
        </PersistentRoomView>
      </>,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("Open A"));
    expect(await screen.findByText("stay visible")).toBeTruthy();
    fireEvent.click(screen.getByText("Open direct"));
    expect(screen.getByText("stay visible")).toBeTruthy();
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
  });

  it("does not spend a message link until the route commits", async () => {
    function Page({ bootstrap }: { bootstrap: typeof baseProps }) {
      return (
        <>
          <a
            href="/chat/rooms/room-channel"
            onClick={(event) => event.preventDefault()}
          >
            Open A
          </a>
          <a
            href="/chat/rooms/room-b?message=msg-b"
            onClick={(event) => event.preventDefault()}
          >
            Open B message
          </a>
          <PersistentRoomView>
            <RoomRouteBootstrap {...bootstrap} />
          </PersistentRoomView>
        </>
      );
    }
    const view = render(
      <Page
        bootstrap={{ ...baseProps, messages: [sampleMessage("A retained")] }}
      />,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("Open A"));
    expect(await screen.findByText("A retained")).toBeTruthy();
    view.rerender(
      <Page
        bootstrap={{
          ...roomBProps,
          messages: [
            {
              ...sampleMessage("B retained"),
              id: "msg-b",
              roomId: "room-b",
            },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByText("Open B message"));
    expect(await screen.findByText("B retained")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it.each(["channel", "direct"] as const)(
    "restores each %s room's reading position on return",
    (kind) => {
      const propsA = {
        ...baseProps,
        rooms: baseProps.rooms.map((room) => ({ ...room, kind })),
      };
      const propsB = {
        ...roomBProps,
        rooms: roomBProps.rooms.map((room) => ({ ...room, kind })),
      };
      const view = render(
        <RoomsClient {...propsA} messages={[sampleMessage("history A")]} />,
        { wrapper: CacheWrapper },
      );
      const position = {
        anchorId: "msg-real",
        anchorCreatedAt: 1234,
        offset: -42,
        atLiveEdge: false,
        visibleMessageIds: ["msg-real"],
      };
      const bindingA = transcriptViewportSpies.position.mock.calls.at(-1)![0];
      expect(bindingA.onPositionChange).toBeTypeOf("function");
      act(() => bindingA.onPositionChange?.(position));
      view.rerender(
        <RoomsClient
          {...propsB}
          messages={[{ ...sampleMessage("history B"), roomId: "room-b" }]}
        />,
      );
      expect(
        transcriptViewportSpies.position.mock.calls.at(-1)![0].initialPosition,
      ).toBeUndefined();
      view.rerender(
        <RoomsClient {...propsA} messagesPromise={new Promise(() => {})} />,
      );
      expect(
        transcriptViewportSpies.position.mock.calls.at(-1)![0].initialPosition,
      ).toEqual(position);
    },
  );

  it("treats confirmed empty history as a hit", async () => {
    const view = render(<RoomsClient {...baseProps} />, {
      wrapper: CacheWrapper,
    });
    expect(screen.getByText("Empty.noMessagesTitle")).toBeTruthy();
    view.rerender(<RoomsClient {...roomBProps} />);
    view.rerender(
      <RoomsClient {...baseProps} messagesPromise={new Promise(() => {})} />,
    );
    expect(screen.getByText("Empty.noMessagesTitle")).toBeTruthy();
    expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
  });

  it("keeps cached messages after a failed background read", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("survives failure")]}
      />,
      { wrapper: CacheWrapper },
    );
    await act(async () => {});
    expect(screen.getByText("survives failure")).toBeTruthy();
    expect(screen.queryByText("Empty.messagesLoadFailedTitle")).toBeNull();
  });

  it("shows an inert room shell while revoked access redirects", async () => {
    render(
      <>
        <a
          href="/chat/rooms/room-channel"
          onClick={(event) => event.preventDefault()}
        >
          Open room
        </a>
        <PersistentRoomView>
          <RoomRouteBootstrap
            {...baseProps}
            messages={[sampleMessage("private history")]}
          />
        </PersistentRoomView>
      </>,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("Open room"));
    expect(await screen.findByText("private history")).toBeTruthy();
    act(() =>
      notifyOrganizationChatRoomsChanged({ removedRoomId: "room-channel" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("private history")).toBeNull(),
    );
    expect(screen.getByTestId("chat-room-loading")).toBeVisible();
    expect(screen.queryByTestId("room-session-composer")).toBeNull();
  });

  it("removes revoked history immediately and refuses a late response", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("private history")]}
      />,
      { wrapper: CacheWrapper },
    );
    expect(screen.getByText("private history")).toBeTruthy();
    act(() =>
      notifyOrganizationChatRoomsChanged({ removedRoomId: "room-channel" }),
    );
    expect(screen.queryByText("private history")).toBeNull();
    await act(async () =>
      finish(backgroundPage([sampleMessage("late private history")])),
    );
    expect(screen.queryByText("late private history")).toBeNull();
  });

  it("discards a snapshot taken before a realtime edit", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <RoomsClient {...baseProps} messages={[sampleMessage("before edit")]} />,
      { wrapper: CacheWrapper },
    );
    act(() =>
      mockRoomRealtime.mock.calls.at(-1)![0].onMessage({
        eventType: "update",
        message: sampleMessage("newer realtime edit"),
      }),
    );
    expect(screen.getByText("newer realtime edit")).toBeTruthy();
    await act(async () =>
      finish(backgroundPage([sampleMessage("before edit")])),
    );
    expect(screen.getByText("newer realtime edit")).toBeTruthy();
    expect(screen.queryByText("before edit")).toBeNull();
  });

  it("expires inactive history after thirty minutes", async () => {
    vi.useFakeTimers();
    const view = render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("expired history")]}
      />,
      { wrapper: CacheWrapper },
    );
    view.rerender(<RoomsClient {...roomBProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    });
    view.rerender(<RoomsClient {...baseProps} loadHistoryOnClient />);
    expect(screen.queryByText("expired history")).toBeNull();
    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
  });

  it("retains older pages loaded through the transcript boundary", async () => {
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: {
        messages: [
          {
            ...sampleMessage("older retained"),
            id: "older",
            createdAt: new Date("2026-06-01"),
          },
        ],
        nextCursor: null,
      },
    });
    const view = render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("newest")]}
        messagesNextCursor="msg-real"
      />,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("loadOlder"));
    expect(await screen.findByText("older retained")).toBeTruthy();
    view.rerender(<RoomsClient {...roomBProps} />);
    view.rerender(<RoomsClient {...baseProps} loadHistoryOnClient />);
    expect(screen.getByText("older retained")).toBeTruthy();
    expect(screen.getByText("newest")).toBeTruthy();
  });

  it("rejects an older page captured before a realtime edit", async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof listRoomMessagesAction>>,
    ) => void;
    vi.mocked(listRoomMessagesAction)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [
            {
              ...sampleMessage("older after retry"),
              id: "older-fresh",
              createdAt: new Date("2026-06-01"),
            },
            sampleMessage("newer edit"),
          ],
          nextCursor: null,
        },
      });
    render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("before edit")]}
        messagesNextCursor="msg-real"
      />,
      { wrapper: CacheWrapper },
    );
    fireEvent.click(screen.getByText("loadOlder"));
    act(() =>
      mockRoomRealtime.mock.calls.at(-1)![0].onMessage({
        eventType: "update",
        message: sampleMessage("newer edit"),
      }),
    );
    await act(async () =>
      finish({
        ok: true,
        value: {
          messages: [
            {
              ...sampleMessage("poisoned older"),
              id: "older-stale",
              createdAt: new Date("2026-06-01"),
            },
            sampleMessage("before edit"),
          ],
          nextCursor: null,
        },
      }),
    );
    expect(await screen.findByText("older after retry")).toBeTruthy();
    expect(screen.getByText("newer edit")).toBeTruthy();
    expect(screen.queryByText("poisoned older")).toBeNull();
    expect(screen.queryByText("before edit")).toBeNull();
    expect(screen.queryByText("Boundary.retry")).toBeNull();
  });

  it("isolates out-of-order responses during A/B/A switches", async () => {
    const finishes: Array<(response: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    const view = render(<RoomsClient {...baseProps} loadHistoryOnClient />, {
      wrapper: CacheWrapper,
    });
    view.rerender(<RoomsClient {...roomBProps} loadHistoryOnClient />);
    view.rerender(<RoomsClient {...baseProps} loadHistoryOnClient />);
    await act(async () =>
      finishes[1](
        backgroundPage([{ ...sampleMessage("late B"), roomId: "room-b" }]),
      ),
    );
    expect(screen.queryByText("late B")).toBeNull();
    await act(async () =>
      finishes[0](backgroundPage([sampleMessage("selected A")])),
    );
    expect(await screen.findByText("selected A")).toBeTruthy();
  });

  it.each(["workspace", "identity"])(
    "clears retained history after a %s change",
    async (change) => {
      let finish!: (response: Response) => void;
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      function Session({ changed }: { changed: boolean }) {
        const currentUserId =
          changed && change === "identity" ? "new-user" : "user-1";
        const workspaceId =
          changed && change === "workspace" ? "new-workspace" : "org-1";
        return (
          <RoomCacheProvider
            currentUserId={currentUserId}
            workspaceId={workspaceId}
          >
            <RoomsClient
              {...baseProps}
              currentUserId={currentUserId}
              activeOrganization={{ ...organization, id: workspaceId }}
              messages={changed ? [] : [sampleMessage("old context")]}
              loadHistoryOnClient={changed}
            />
          </RoomCacheProvider>
        );
      }
      const view = render(<Session changed={false} />, {
        wrapper: TestQueryProvider,
      });
      view.rerender(<Session changed />);
      expect(screen.queryByText("old context")).toBeNull();
      await act(async () =>
        finish(backgroundPage([sampleMessage("late old context")])),
      );
      expect(screen.queryByText("late old context")).toBeNull();
      expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
    },
  );

  it("allows confirmed rejoin without reviving the old transcript", async () => {
    const view = render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("before leaving")]}
      />,
      { wrapper: CacheWrapper },
    );
    act(() =>
      notifyOrganizationChatRoomsChanged({ removedRoomId: "room-channel" }),
    );
    view.rerender(<RoomsClient {...baseProps} loadHistoryOnClient />);
    act(() =>
      notifyOrganizationChatRoomsChanged({
        room: channelRoom(),
        joinedRoomId: "room-channel",
      }),
    );
    expect(screen.queryByText("before leaving")).toBeNull();
    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();
  });

  it("clears history on logout", async () => {
    render(
      <RoomsClient
        {...baseProps}
        messages={[sampleMessage("signed out history")]}
      />,
      { wrapper: CacheWrapper },
    );
    act(() => window.dispatchEvent(new Event("chat-session-ended")));
    expect(screen.queryByText("signed out history")).toBeNull();
  });
});
