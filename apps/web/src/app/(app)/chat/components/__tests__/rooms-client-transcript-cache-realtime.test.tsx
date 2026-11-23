import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => ({
    network: "Mainnet",
    vercelEnv: "production",
  }),
}));

const {
  authorizeMock,
  getMock,
  channelsByName,
  ablyClient,
  connectedListeners,
  mockSearch,
  mockSearchParams,
  mockPathname,
  markOrganizationChatRoomReadAction,
} = vi.hoisted(() => {
  const authorize = vi.fn();
  const get = vi.fn();
  const connectedListeners = new Set<() => void>();
  const mockSearch = { current: "" };
  return {
    connectedListeners,
    authorizeMock: authorize,
    getMock: get,
    channelsByName: new Map<string, FakeChannel>(),
    ablyClient: {
      connection: {
        state: "connected",
        on: (_event: string, listener: () => void) =>
          connectedListeners.add(listener),
        off: (_event: string, listener: () => void) =>
          connectedListeners.delete(listener),
      },
      auth: { authorize },
      channels: { get },
    },
    mockSearch,
    mockSearchParams: vi.fn(() => new URLSearchParams(mockSearch.current)),
    mockPathname: vi.fn(() => "/chat/rooms/room-a"),
    markOrganizationChatRoomReadAction: vi.fn(async (roomId: string) => ({
      ok: true as const,
      value: {
        id: roomId,
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      },
    })),
  };
});

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));

vi.mock("@/app/chat/components/day-separator", () => ({
  default: () => null,
  DayPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/hooks/effects/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobileMedia: () => false,
}));

vi.mock("@/app/components/header/use-header-room-slot-host", () => ({
  useHeaderRoomSlotHost: () => null,
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/effects/use-room-typing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/effects/use-room-typing")>();
  return {
    ...actual,
    useRoomTypingSync: () => undefined,
  };
});

vi.mock("@/hooks/effects/use-selected-room-channel-health", () => ({
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
    sendStreamMessage: vi.fn(() => true),
  }),
}));

vi.mock("@/app/chat/actions", () => ({
  archiveRoomAction: vi.fn(),
  leaveRoomAction: vi.fn(),
  updateRoomAction: vi.fn(),
  listUnreadThreadReplyCountsAction: vi.fn(async () => ({
    ok: true as const,
    value: [],
  })),
  deleteRoomMessageAction: vi.fn(),
  editRoomMessageAction: vi.fn(),
  getRoomThreadAction: vi.fn(),
  listPinnedMessagesAction: vi.fn(async () => ({
    ok: true as const,
    value: { items: [], nextCursor: null, total: 0 },
  })),
  listRoomMessagesAction: vi.fn(async () => ({
    ok: true as const,
    value: { messages: [], nextCursor: null },
  })),
  listThreadMessagesAction: vi.fn(async () => ({
    ok: true as const,
    value: { messages: [], nextCursor: null },
  })),
  markThreadReadAction: vi.fn(),
  pinRoomMessageAction: vi.fn(),
  removeRoomMessageUnfurlAction: vi.fn(),
  retryRoomMentionAction: vi.fn(),
  sendRoomMessageAction: vi.fn(),
  setMessageReactionAction: vi.fn(),
  unpinRoomMessageAction: vi.fn(),
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomReadAction,
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: () => <div data-testid="room-session-composer" />,
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row" data-message-id={message.id}>
      {message.content}
    </div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
}));

vi.mock("../chat-participant-hover-card", () => ({
  ChatParticipantHoverCard: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => null,
  LiveMemberPresenceText: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import type { RoomMessagePage } from "@/app/chat/hooks/use-room-initial-messages";
import type { RoomTranscriptEntry } from "@/app/chat/utils/room-transcript-cache";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";
import { chatQueryKeys } from "@/queries/chat";
import { RoomCacheProvider } from "../room-cache-provider";
import { RoomsClient, type RoomsClientProps } from "../rooms-client";

type FakeChannelListener = (message: { data: unknown }) => void;

interface FakeChannel {
  name: string;
  attached: boolean;
  listeners: Map<string, Set<FakeChannelListener>>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  emit: (event: string, data: unknown) => void;
}

function channelFor(name: string): FakeChannel {
  let channel = channelsByName.get(name);
  if (!channel) {
    const listeners = new Map<string, Set<FakeChannelListener>>();
    const created: FakeChannel = {
      name,
      attached: false,
      listeners,
      subscribe: vi.fn((event: string, listener: FakeChannelListener) => {
        created.attached = true;
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(listener);
      }),
      unsubscribe: vi.fn((event: string, listener?: FakeChannelListener) => {
        if (!listener) {
          listeners.delete(event);
          return;
        }
        listeners.get(event)?.delete(listener);
      }),
      detach: vi.fn(() => {
        created.attached = false;
      }),
      emit: (event: string, data: unknown) => {
        if (!created.attached) return;
        for (const listener of listeners.get(event) ?? []) {
          listener({ data });
        }
      },
    };
    channel = created;
    channelsByName.set(name, channel);
  }
  return channel;
}

function tokenWithRooms(...roomIds: string[]) {
  const capability: Record<string, string[]> = {
    "notifications:all:user-1": ["subscribe"],
    "chat_control:user_user-1": ["subscribe"],
  };
  for (const roomId of roomIds) {
    capability[`chat_rooms:room_${roomId}`] = ["subscribe"];
  }
  return { capability: JSON.stringify(capability) };
}

function createFlightThenable<T>() {
  const onFulfilledList: Array<(value: T) => void> = [];
  const onRejectedList: Array<(reason: unknown) => void> = [];
  let state:
    | { status: "pending" }
    | { status: "fulfilled"; value: T }
    | { status: "rejected"; reason: unknown } = { status: "pending" };

  const thenable = {
    then(
      onFulfilled?: ((value: T) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      if (state.status === "fulfilled") {
        onFulfilled?.(state.value);
      } else if (state.status === "rejected") {
        onRejected?.(state.reason);
      } else {
        if (onFulfilled) onFulfilledList.push(onFulfilled);
        if (onRejected) onRejectedList.push(onRejected);
      }
      return undefined;
    },
  } as unknown as Promise<T>;

  return {
    thenable,
    resolve(value: T) {
      if (state.status !== "pending") return;
      state = { status: "fulfilled", value };
      for (const fn of onFulfilledList) fn(value);
    },
    reject(reason: unknown) {
      if (state.status !== "pending") return;
      state = { status: "rejected", reason };
      for (const fn of onRejectedList) fn(reason);
    },
  };
}

function makeRoom(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id,
    organizationId: "org-1",
    organizationName: "Acme",
    name: id,
    slug: id,
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    isReadOnly: false,
    formerUserMembers: [],
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
    userMembers: [
      {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "online",
      },
    ],
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  };
}

function makeMessage(
  id: string,
  content: string,
  minute: number,
  roomId = "room-a",
): ChatRoomMessage {
  return {
    id,
    roomId,
    parentMessageId: null,
    content,
    createdAt: new Date(
      `2026-07-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
    ),
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
        id: "user-2",
        name: "Bob",
        email: "bob@example.com",
        image: null,
        presence: "online",
      },
    },
  };
}

function wireMessage(message: ChatRoomMessage) {
  return JSON.parse(JSON.stringify(message));
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

function baseProps(
  overrides: Partial<RoomsClientProps> = {},
): RoomsClientProps {
  return {
    activeOrganization: { id: "org-1", slug: "acme" },
    rooms: [makeRoom("room-a")],
    organizationMembers: [],
    currentUserId: "user-1",
    isOrgOwnerOrAdmin: false,
    coworkers: [],
    selectedRoomId: "room-a",
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [],
    messagesNextCursor: null,
    ...overrides,
  };
}

function renderInRetainedCache(
  ui: ReactNode,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
        {children}
      </RoomCacheProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper }) };
}

describe("RoomsClient transcript cache + real useChatRoomRealtime", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    connectedListeners.clear();
    ablyClient.connection.state = "connected";
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));
    getMock.mockImplementation((name: string) => channelFor(name));
    mockSearch.current = "";
    mockPathname.mockReturnValue("/chat/rooms/room-a");
    markOrganizationChatRoomReadAction.mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches the cached Transcript in place on realtime create and edit without refetching", async () => {
    const m1 = makeMessage("m1", "initial message", 1);
    const { queryClient } = renderInRetainedCache(
      <RoomsClient {...baseProps({ messages: [m1] })} />,
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_message", expect.any(Function));
    });
    const fetchCallsBefore = vi.mocked(fetch).mock.calls.length;

    const m2 = makeMessage("m2", "arrived over ably", 2);
    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "create",
        message: wireMessage(m2),
      });
    });

    expect(screen.getByText("arrived over ably")).toBeTruthy();
    const cachedAfterCreate = queryClient.getQueryData<RoomTranscriptEntry>(
      chatQueryKeys.transcript(
        { userId: "user-1", workspaceId: "org-1" },
        "room-a",
      ),
    );
    expect(cachedAfterCreate?.transcript.messages.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);

    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "update",
        message: wireMessage({
          ...m2,
          content: "edited over ably",
          editedAt: new Date("2026-07-01T12:03:00.000Z"),
        }),
      });
    });

    expect(screen.getByText("edited over ably")).toBeTruthy();
    expect(screen.queryByText("arrived over ably")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore);
  });

  it("does not lose a realtime message arriving during an in-flight head page read", async () => {
    const mOld = makeMessage("m1", "older page row", 1);
    const mLive = makeMessage("m2", "live during fetch", 2);
    let finishFirstRead!: (response: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirstRead = resolve;
          }),
      )
      .mockResolvedValueOnce(backgroundPage([mOld, mLive]));

    renderInRetainedCache(
      <RoomsClient {...baseProps({ loadHistoryOnClient: true })} />,
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_message", expect.any(Function));
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    // Realtime message arrives while the first head page read is still in flight.
    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "create",
        message: wireMessage(mLive),
      });
    });
    expect(screen.getByText("live during fetch")).toBeTruthy();

    // First head read resolves with a stale snapshot that does not contain mLive.
    await act(async () => {
      finishFirstRead(backgroundPage([mOld]));
    });

    // Stale snapshot must not drop mLive; follow-up read brings mOld + mLive together.
    await waitFor(() => {
      expect(screen.getByText("older page row")).toBeTruthy();
    });
    expect(screen.getByText("live during fetch")).toBeTruthy();
  });

  it("does not lose a realtime message arriving while the server messagesPromise is in flight", async () => {
    const flight = createFlightThenable<RoomMessagePage>();
    const mOld = makeMessage("m1", "from server promise", 1);
    const mLive = makeMessage("m2", "live before promise resolves", 2);

    renderInRetainedCache(
      <RoomsClient {...baseProps({ messagesPromise: flight.thenable })} />,
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_message", expect.any(Function));
    });

    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "create",
        message: wireMessage(mLive),
      });
    });
    expect(screen.getByText("live before promise resolves")).toBeTruthy();

    act(() => {
      flight.resolve({
        messages: [mOld],
        nextCursor: null,
        failed: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("from server promise")).toBeTruthy();
    });
    expect(screen.getByText("live before promise resolves")).toBeTruthy();
  });

  it("ignores a realtime edit for a message not yet loaded instead of creating it", async () => {
    const mLoaded = makeMessage("m10", "head page message", 10);
    const { queryClient } = renderInRetainedCache(
      <RoomsClient
        {...baseProps({
          messages: [mLoaded],
          messagesNextCursor: "m10",
        })}
      />,
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_message", expect.any(Function));
    });

    const mUnloaded = {
      ...makeMessage("m1", "edited older unloaded message", 1),
      editedAt: new Date("2026-07-01T12:12:00.000Z"),
    };
    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "update",
        message: wireMessage(mUnloaded),
      });
    });

    expect(screen.queryByText("edited older unloaded message")).toBeNull();
    expect(screen.getByText("head page message")).toBeTruthy();
    const cached = queryClient.getQueryData<RoomTranscriptEntry>(
      chatQueryKeys.transcript(
        { userId: "user-1", workspaceId: "org-1" },
        "room-a",
      ),
    );
    expect(cached?.transcript.messages.map((m) => m.id)).toEqual(["m10"]);
  });

  it("shows today's failed state when a deferred Flight history promise rejects in retained cache", async () => {
    const flight = createFlightThenable<RoomMessagePage>();

    renderInRetainedCache(
      <RoomsClient {...baseProps({ messagesPromise: flight.thenable })} />,
    );

    expect(screen.getByTestId("room-message-list-skeleton")).toBeTruthy();

    act(() => {
      flight.reject(new Error("history stream failed"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByText("Empty.messagesLoadFailedTitle")).toBeTruthy();
    expect(screen.getByTestId("room-session-composer")).toBeTruthy();
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
  });

  it("shows a recently visited room's cached Transcript at once on reopen and keeps its Unread divider", async () => {
    mockSearch.current = "message=m2";
    const m1 = makeMessage("m1", "already read", 1);
    const m2 = makeMessage("m2", "first unread", 2);
    const m3 = makeMessage("m3", "new arrival", 3);
    const flightA = createFlightThenable<RoomMessagePage>();
    const unreadRoomA = makeRoom("room-a", {
      unreadCount: 1,
      channelUnreadCount: 1,
    });

    const view = renderInRetainedCache(
      <RoomsClient
        {...baseProps({
          rooms: [unreadRoomA],
          messagesPromise: flightA.thenable,
        })}
      />,
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_message", expect.any(Function));
    });

    act(() => {
      flightA.resolve({
        messages: [m1, m2],
        nextCursor: null,
        failed: false,
        firstUnreadMessageId: "m2",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("first unread")).toBeTruthy();
    });
    const dividerRow = () =>
      screen
        .queryByText("UnreadDivider.label")
        ?.closest(".flow-root")
        ?.querySelector("[data-message-id]")
        ?.getAttribute("data-message-id");
    expect(dividerRow()).toBe("m2");

    // Realtime arrival and edit leave the Unread divider on m2.
    act(() => {
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "create",
        message: wireMessage(m3),
      });
      channelFor("chat_rooms:room_room-a").emit("chat_room_message", {
        eventType: "update",
        message: wireMessage({ ...m2, content: "first unread edited" }),
      });
    });
    expect(screen.getByText("new arrival")).toBeTruthy();
    expect(screen.getByText("first unread edited")).toBeTruthy();
    expect(dividerRow()).toBe("m2");

    // Switch to room B, then return to room A with an unresolved promise:
    // room A's cached Transcript (including the realtime arrival and edit) shows at once.
    mockSearch.current = "";
    view.rerender(
      <RoomsClient
        {...baseProps({
          selectedRoomId: "room-b",
          rooms: [makeRoom("room-b")],
          messages: [makeMessage("b1", "room b row", 1, "room-b")],
        })}
      />,
    );
    expect(await screen.findByText("room b row")).toBeTruthy();

    view.rerender(
      <RoomsClient
        {...baseProps({
          rooms: [makeRoom("room-a")],
          messagesPromise: createFlightThenable<RoomMessagePage>().thenable,
        })}
      />,
    );
    expect(screen.getByText("first unread edited")).toBeTruthy();
    expect(screen.getByText("new arrival")).toBeTruthy();
    expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
  });
});
