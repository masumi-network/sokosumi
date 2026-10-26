import "./rooms-client-harness";
import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { getRoomMessageAction } from "@/app/chat/message-actions";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import { TestQueryProvider } from "@/test/query-provider";
import { RoomCacheProvider } from "../room-cache-provider";
import { RoomsClient } from "../rooms-client";
import {
  channelRoom,
  listRoomMessagesAction,
  markOrganizationChatRoomReadAction,
  mockReplace,
  mockSearch,
  renderWithQueryClient,
  roomsClientBaseProps,
  sampleMessage,
  useChatRoomRealtimeMock,
} from "./rooms-client-harness";
import {
  transcriptViewportEnd,
  transcriptViewportSpies,
} from "./transcript-viewport-stub";

const { fetchRoomMessagesMock } = vi.hoisted(() => ({
  fetchRoomMessagesMock: vi.fn(),
}));

vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: fetchRoomMessagesMock,
}));

vi.mock("@/app/chat/message-actions", () => ({
  getRoomMessageAction: vi.fn(),
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
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

// `data-message-id` is what a landing looks for.
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row" data-message-id={message.id}>
      {message.content}
    </div>
  ),
}));

/** The harness translates to the key itself. */
const DIVIDER_NAME = "UnreadDivider.accessibleName";

function message(
  id: string,
  minute: number,
  from: "self" | "peer" = "peer",
): ChatRoomMessage {
  const base = sampleMessage(`body of ${id}`, id);
  return {
    ...base,
    createdAt: new Date(Date.UTC(2026, 6, 1, 12, minute)),
    sender:
      from === "self"
        ? base.sender
        : {
            type: "user",
            user: {
              id: "user-2",
              name: "Bob",
              email: "bob@example.com",
              image: null,
              presence: "offline",
            },
          },
  };
}

const read1 = message("read-1", 1, "self");
const read2 = message("read-2", 2);
const unread1 = message("unread-1", 3);
const unread2 = message("unread-2", 4);

function unreadRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return channelRoom({ unreadCount: 2, channelUnreadCount: 2, ...overrides });
}

function page(
  messages: ChatRoomMessage[],
  firstUnreadMessageId: string | null,
  nextCursor: string | null = null,
) {
  return { messages, nextCursor, firstUnreadMessageId };
}

/** Core's open-at-unread answer; every other background read finds nothing. */
function answerOpenAtUnread(answer: ReturnType<typeof page> | null) {
  fetchRoomMessagesMock.mockImplementation(
    async (
      _roomId: string,
      _parent: string | null,
      options?: { openAtUnread?: boolean },
    ) => (options?.openAtUnread ? answer : null),
  );
}

function openAtUnreadCalls() {
  return fetchRoomMessagesMock.mock.calls.filter(
    ([, , options]) => options?.openAtUnread === true,
  );
}

function divider() {
  return screen.queryByRole("separator", { name: DIVIDER_NAME });
}

/** The message the divider sits above: the one in the same transcript row. */
function dividerMessageId() {
  return (
    divider()
      ?.closest(".flow-root")
      ?.querySelector("[data-message-id]")
      ?.getAttribute("data-message-id") ?? null
  );
}

async function deliver(event: unknown) {
  const onMessage = useChatRoomRealtimeMock.mock.calls.at(-1)?.[0].onMessage;
  await act(async () =>
    onMessage?.(
      chatRoomMessageEventDataSchema.parse(JSON.parse(JSON.stringify(event))),
    ),
  );
}

async function reachEnd(atEnd = true) {
  await act(async () => transcriptViewportEnd.report(atEnd));
}

function RetainedRooms({ children }: { children: ReactNode }) {
  return (
    <TestQueryProvider>
      <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
        {children}
      </RoomCacheProvider>
    </TestQueryProvider>
  );
}

function openRoom(overrides: Partial<ChatRoom> = {}) {
  return renderWithQueryClient(
    <RoomsClient
      {...roomsClientBaseProps({
        rooms: [unreadRoom(overrides)],
        messages: [read1, read2, unread1, unread2],
      })}
    />,
  );
}

describe("RoomsClient opens a room at the Unread divider", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    vi.clearAllMocks();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    answerOpenAtUnread(page([read1, read2, unread1, unread2], "unread-1"));
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [], nextCursor: null },
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: { ...channelRoom(), id: roomId },
      }),
    );
  });

  it("opens through Core's open-at-unread mode, a third of the way down, above the first unread message", async () => {
    openRoom();
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    expect(openAtUnreadCalls()).toEqual([
      [
        "room-channel",
        null,
        { openAtUnread: true, signal: expect.any(AbortSignal) },
      ],
    ]);
    expect(
      transcriptViewportSpies.position.mock.calls[0]?.[0].initialPosition,
    ).toMatchObject({
      anchorId: "unread-1",
      atLiveEdge: false,
      viewportShare: 1 / 3,
    });
    // Read messages stay above it.
    expect(screen.getByText("body of read-2")).toBeTruthy();
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

    await reachEnd();
    await waitFor(() =>
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1),
    );
  });

  it("aborts an open-at-unread read still out when the visit ends", async () => {
    fetchRoomMessagesMock.mockImplementation(() => new Promise(() => {}));
    const view = openRoom();
    await waitFor(() => expect(openAtUnreadCalls()).toHaveLength(1));
    const signal: AbortSignal = openAtUnreadCalls()[0]?.[2].signal;
    expect(signal.aborted).toBe(false);

    view.unmount();

    expect(signal.aborted).toBe(true);
  });

  it("opens a retained room at the divider as well", async () => {
    render(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [unreadRoom()],
          messages: [read1, read2, unread1, unread2],
        })}
      />,
      { wrapper: RetainedRooms },
    );
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    expect(openAtUnreadCalls()).toHaveLength(1);
    expect(
      transcriptViewportSpies.position.mock.calls[0]?.[0].initialPosition
        ?.anchorId,
    ).toBe("unread-1");
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
  });

  it("opens on the open-at-unread read the click started, not a second one", async () => {
    const room = unreadRoom();
    publishMembershipVisibleRooms([room], "org-1", "user-1");
    const view = render(<a href={`/chat/rooms/${room.id}`}>{room.name}</a>, {
      wrapper: RetainedRooms,
    });
    screen.getByRole("link", { name: room.name }).click();
    await waitFor(() => expect(openAtUnreadCalls()).toHaveLength(1));

    view.rerender(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          messages: [read1, read2, unread1, unread2],
        })}
      />,
    );
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    // The click's read carries no visit signal; the room asked for no other.
    expect(openAtUnreadCalls()).toEqual([
      [room.id, null, { openAtUnread: true }, expect.any(Function)],
    ]);
    clearMembershipVisibleRoomsSnapshot();
  });

  it("joins an older divider window to the newest page through the gap row", async () => {
    const old1 = message("old-1", 0, "self");
    const old2 = message("old-2", 1);
    answerOpenAtUnread(page([old1, old2], "old-2", "old-1"));
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [unreadRoom()],
          messages: [unread1, unread2],
          messagesNextCursor: "unread-1",
        })}
      />,
    );
    await waitFor(() => expect(dividerMessageId()).toBe("old-2"));

    expect(screen.getByText("Boundary.missingHere")).toBeTruthy();
    expect(
      transcriptViewportSpies.position.mock.calls[0]?.[0].initialPosition
        ?.anchorId,
    ).toBe("old-2");
  });

  it("joins an older divider window in a retained room too", async () => {
    const old1 = message("old-1", 0, "self");
    const old2 = message("old-2", 1);
    answerOpenAtUnread(page([old1, old2], "old-2", "old-1"));
    fetchRoomMessagesMock.mockImplementation(
      async (
        _roomId: string,
        parent: string | null,
        options?: { openAtUnread?: boolean },
      ) =>
        options?.openAtUnread
          ? page([old1, old2], "old-2", "old-1")
          : parent
            ? null
            : page([unread1, unread2], "old-2", "unread-1"),
    );
    render(
      <RoomsClient
        {...roomsClientBaseProps({ rooms: [unreadRoom()], messages: [] })}
      />,
      { wrapper: RetainedRooms },
    );
    await waitFor(() => expect(dividerMessageId()).toBe("old-2"));

    expect(screen.getByText("Boundary.missingHere")).toBeTruthy();
    expect(screen.getByText("body of unread-2")).toBeTruthy();
  });

  it("keeps the divider in place through arrivals, own posts and later reads", async () => {
    openRoom();
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    await deliver({ eventType: "create", message: message("peer-new", 5) });
    await deliver({
      eventType: "create",
      message: message("own-new", 6, "self"),
    });
    // The read answers with no Room unread left.
    await reachEnd();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalled();

    expect(screen.getByText("body of own-new")).toBeTruthy();
    expect(dividerMessageId()).toBe("unread-1");
  });

  it("moves the divider to the next message when its message is deleted, and not on an edit", async () => {
    openRoom();
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    await deliver({
      eventType: "update",
      message: { ...unread1, content: "edited", editedAt: new Date() },
    });
    expect(dividerMessageId()).toBe("unread-1");

    await deliver({
      eventType: "delete",
      messageId: "unread-1",
      roomId: "room-channel",
      parentMessageId: null,
    });
    expect(dividerMessageId()).toBe("unread-2");

    await deliver({
      eventType: "delete",
      messageId: "unread-2",
      roomId: "room-channel",
      parentMessageId: null,
    });
    expect(divider()).toBeNull();
  });

  it("places the divider again on the next visit, and none once the room was read", async () => {
    const view = openRoom();
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));

    const other = { ...channelRoom(), id: "room-other", name: "other" };
    view.rerender(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [channelRoom(), other],
          selectedRoomId: "room-other",
          messages: [{ ...read1, roomId: "room-other" }],
        })}
      />,
    );
    await act(async () => {});
    expect(divider()).toBeNull();

    view.rerender(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [channelRoom()],
          messages: [read1, read2, unread1, unread2],
        })}
      />,
    );
    await act(async () => {});
    expect(divider()).toBeNull();
    expect(openAtUnreadCalls()).toHaveLength(1);
  });

  it.each<[string, Partial<ChatRoom>]>([
    ["a room that opened read", { unreadCount: 0, channelUnreadCount: 0 }],
    ["a room whose open-at-unread read failed", {}],
  ])("never places a divider mid-visit in %s", async (_name, overrides) => {
    const arrival = message("peer-new", 5);
    // Every later head read names the arrival, as Core would once it is
    // unread below a reader scrolled up.
    fetchRoomMessagesMock.mockImplementation(
      async (
        _roomId: string,
        parent: string | null,
        options?: { openAtUnread?: boolean },
      ) =>
        options?.openAtUnread || parent
          ? null
          : page([read1, read2, arrival], "peer-new"),
    );
    openRoom(overrides);
    await act(async () => {});
    await reachEnd(false);
    await deliver({ eventType: "create", message: arrival });

    const headReads = () =>
      fetchRoomMessagesMock.mock.calls.filter(
        ([, parent, options]) => !parent && !options?.openAtUnread,
      ).length;
    const before = headReads();
    // Any later read: reconnecting runs one at once.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(headReads()).toBeGreaterThan(before));
    await act(async () => {});

    expect(screen.getByText("body of peer-new")).toBeTruthy();
    expect(divider()).toBeNull();
  });

  it("opens a room that is only Marked unread as today, with no divider", async () => {
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [
            channelRoom({
              unreadCount: 0,
              channelUnreadCount: 0,
              markedUnread: true,
            }),
          ],
          messages: [read1, read2],
        })}
      />,
    );
    await act(async () => {});

    expect(openAtUnreadCalls()).toHaveLength(0);
    expect(divider()).toBeNull();
    expect(
      transcriptViewportSpies.position.mock.calls[0]?.[0].initialPosition,
    ).toBeUndefined();
  });

  it("does not place a divider for Thread unread alone", async () => {
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [
            channelRoom({
              unreadCount: 3,
              channelUnreadCount: 0,
              threadUnreadCount: 3,
            }),
          ],
          messages: [read1, read2],
        })}
      />,
    );
    await act(async () => {});
    expect(openAtUnreadCalls()).toHaveLength(0);
  });

  it.each<[string, Partial<ChatRoom>]>([
    ["a Muted room", { mutedAt: new Date("2026-07-01T00:00:00.000Z") }],
    ["a Direct", { kind: "direct", discoverability: null }],
    ["an External channel", { discoverability: "external" }],
  ])("opens %s at its divider too", async (_name, overrides) => {
    openRoom(overrides);
    await waitFor(() => expect(dividerMessageId()).toBe("unread-1"));
  });

  it("lets a named message win, and still draws the divider from the window that jump loads", async () => {
    mockReplace.mockImplementation((href: string) => {
      mockSearch.current = href.split("?")[1] ?? "";
    });
    mockSearch.current = "message=old-target";
    const target = message("old-target", 0);
    const afterTarget = message("old-unread", 1);
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true,
      value: target,
    });
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: page([target, afterTarget], "old-unread", "x"),
    });
    const props = roomsClientBaseProps({
      rooms: [unreadRoom()],
      messages: [unread1, unread2],
    });
    const view = renderWithQueryClient(<RoomsClient {...props} />);
    await act(async () => {});
    view.rerender(<RoomsClient {...props} />);
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-message-id="old-target"]')
          ?.getAttribute("data-search-landed"),
      ).toBe("true"),
    );

    expect(openAtUnreadCalls()).toHaveLength(0);
    expect(
      transcriptViewportSpies.position.mock.calls[0]?.[0].initialPosition,
    ).toBeUndefined();
    expect(dividerMessageId()).toBe("old-unread");
  });

  describe("when a named message already loaded wins the open", () => {
    beforeEach(() => {
      mockReplace.mockImplementation((href: string) => {
        mockSearch.current = href.split("?")[1] ?? "";
      });
      mockSearch.current = "message=read-2";
    });

    async function openOnNamedMessage(
      props: Parameters<typeof roomsClientBaseProps>[0],
    ) {
      const view = renderWithQueryClient(
        <RoomsClient {...roomsClientBaseProps(props)} />,
      );
      await act(async () => {});
      view.rerender(<RoomsClient {...roomsClientBaseProps(props)} />);
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-message-id="read-2"]')
            ?.getAttribute("data-search-landed"),
        ).toBe("true"),
      );
      await act(async () => {});
    }

    async function readAgainNaming(arrival: ChatRoomMessage) {
      fetchRoomMessagesMock.mockImplementation(
        async (_roomId: string, parent: string | null) =>
          parent
            ? null
            : page([read1, read2, unread1, unread2, arrival], arrival.id),
      );
      const reads = fetchRoomMessagesMock.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() =>
        expect(fetchRoomMessagesMock.mock.calls.length).toBeGreaterThan(reads),
      );
      await act(async () => {});
    }

    it("draws no divider later when no answer of the open named one", async () => {
      await openOnNamedMessage({
        rooms: [unreadRoom()],
        messages: [read1, read2, unread1, unread2],
      });
      expect(openAtUnreadCalls()).toHaveLength(0);

      const arrival = message("peer-new", 5);
      await deliver({ eventType: "create", message: arrival });
      await readAgainNaming(arrival);

      expect(screen.getByText("body of peer-new")).toBeTruthy();
      expect(divider()).toBeNull();
    });

    it("draws the divider the deferred first page names, and keeps it", async () => {
      await openOnNamedMessage({
        rooms: [unreadRoom()],
        messagesPromise: Promise.resolve({
          messages: [read1, read2, unread1, unread2],
          nextCursor: null,
          failed: false,
          firstUnreadMessageId: "unread-1",
        }),
      });
      expect(dividerMessageId()).toBe("unread-1");

      await readAgainNaming(message("peer-new", 5));

      expect(dividerMessageId()).toBe("unread-1");
    });
  });

  it("shares one row with the day separator when both sit above the same message", async () => {
    answerOpenAtUnread(page([read1, read2, unread1, unread2], "read-1"));
    openRoom();
    await waitFor(() => expect(dividerMessageId()).toBe("read-1"));

    const row = divider()?.closest(".flow-root");
    expect(row?.textContent).toContain(
      formatDaySeparator(new Date(read1.createdAt)),
    );
    expect(row?.textContent).toContain("UnreadDivider.label");
  });
});
