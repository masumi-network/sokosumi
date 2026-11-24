// @vitest-environment happy-dom

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteChatReadThrottled,
  resetChatReadThrottleForTests,
} from "@/lib/chat/chat-read-throttle";
import { makeRoom as makeFixtureRoom } from "./__tests__/chat-room-fixtures";
import { createChatListStore } from "./chat-list-store";
import { CHAT_HEALTHY_REFRESH_MS } from "./chat-refresh-scheduler";
import { clearMembershipVisibleRoomsSnapshot } from "./membership-visible-rooms-store";
import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOM_READ_EVENT,
} from "./organization-chat-events";
import {
  beginRoomAttentionRefresh,
  clearRoomReadOverlays,
} from "./room-read-overlay";

const { fetchBackgroundJsonMock, fetchSidebarRoomCollectionSpy } = vi.hoisted(
  () => ({
    fetchBackgroundJsonMock:
      vi.fn<
        (
          url: string,
          timeoutMs: number,
          onStatus?: (status: number) => void,
        ) => Promise<unknown>
      >(),
    fetchSidebarRoomCollectionSpy: vi.fn(),
  }),
);

vi.mock("./fetch-background-json", () => ({
  fetchBackgroundJson: (...args: Parameters<typeof fetchBackgroundJsonMock>) =>
    fetchBackgroundJsonMock(...args),
}));

vi.mock("./fetch-sidebar-room-collection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./fetch-sidebar-room-collection")>();
  return {
    ...actual,
    fetchSidebarRoomCollection: (
      ...args: Parameters<typeof actual.fetchSidebarRoomCollection>
    ) =>
      fetchSidebarRoomCollectionSpy(...args) ??
      actual.fetchSidebarRoomCollection(...args),
  };
});

const TIMESTAMP = "2026-09-08T10:00:00.000Z";
const NO_ROOMS: ChatRoom[] = [];
const NO_INVITATIONS: ChatRoomInvitation[] = [];

function makeRoom(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return makeFixtureRoom({
    id,
    name: id,
    slug: id,
    createdAt: new Date(TIMESTAMP),
    updatedAt: new Date(TIMESTAMP),
    userMembers: [],
    ...overrides,
  });
}

function rawRoom(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...makeRoom(id),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function rawInvitation(id: string) {
  return {
    id,
    roomId: `room-${id}`,
    createdAt: TIMESTAMP,
    expiresAt: TIMESTAMP,
  };
}

function pageEnvelope(data: unknown[]) {
  return {
    data,
    meta: {
      timestamp: TIMESTAMP,
      requestId: "req-1",
      pagination: { nextCursor: null },
    },
  };
}

function roomEnvelope(room: Record<string, unknown> | null) {
  return {
    data: room,
    meta: {
      timestamp: TIMESTAMP,
      requestId: "req-1",
    },
  };
}

function batchedEnvelope(parts: Record<string, unknown>) {
  return { data: parts };
}

function messageIn(roomId: string) {
  notifyOrganizationChatRoomsChanged({ collections: ["active"], roomId });
}

function revokeRoom(removedRoomId: string) {
  notifyOrganizationChatRoomsChanged({ removedRoomId });
}

async function flushMicrotasks(turns = 30) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describe("createChatListStore", () => {
  const attachedStores: Array<{ detach: () => void }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fetchBackgroundJsonMock.mockReset();
    fetchSidebarRoomCollectionSpy.mockReset();
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    resetChatReadThrottleForTests();
  });

  afterEach(() => {
    for (const store of attachedStores.splice(0)) {
      store.detach();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    resetChatReadThrottleForTests();
  });

  function createAttachedStore({
    rooms = NO_ROOMS,
    archivedRooms = NO_ROOMS,
    pendingInvitations = NO_INVITATIONS,
    healthy = true,
    organizationId = "org-1",
    currentUserId = "user-1",
  }: {
    rooms?: ChatRoom[];
    archivedRooms?: ChatRoom[];
    pendingInvitations?: ChatRoomInvitation[];
    healthy?: boolean;
    organizationId?: string | null;
    currentUserId?: string;
  } = {}) {
    const store = createChatListStore({
      rooms,
      archivedRooms,
      pendingInvitations,
      currentUserId,
      organizationId,
      paintOnly: false,
      healthy,
    });
    attachedStores.push(store);
    store.attach({ organizationId, currentUserId });
    return store;
  }

  it("batches same-task active and invitations mount reads into one request", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([rawInvitation("inv-1")]),
      }),
    );

    const store = createAttachedStore();
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?collections=active,invitations",
    );
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "room-a",
    ]);
    expect(store.getSnapshot().pendingRows.map((inv) => inv.id)).toEqual([
      "inv-1",
    ]);
    store.detach();
  });

  it("stops cleanly when detach() is called synchronously inside the first mount refresh", async () => {
    const store = createChatListStore({
      rooms: NO_ROOMS,
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
      currentUserId: "user-1",
      organizationId: "org-1",
      paintOnly: false,
      healthy: false,
    });

    const calledCollections: string[] = [];
    fetchSidebarRoomCollectionSpy.mockImplementation((collection: string) => {
      calledCollections.push(collection);
      store.detach();
      return Promise.resolve({
        rooms: [makeRoom("stale-after-detach")],
        nextCursor: null,
      });
    });

    store.attach({ organizationId: "org-1", currentUserId: "user-1" });
    await flushMicrotasks();

    expect(calledCollections).toEqual(["active"]);
    expect(store.getSnapshot().roomRows).toEqual([]);
    expect(store.getSnapshot().pendingRows).toEqual([]);

    fetchSidebarRoomCollectionSpy.mockReset();
    fetchBackgroundJsonMock.mockClear();
    // Listeners and timers must stay quiet after detach.
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    expect(fetchBackgroundJsonMock).not.toHaveBeenCalled();
  });

  it("reads current rows immediately: upsert + invalidate in same stack takes the one-room path", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    fetchBackgroundJsonMock.mockResolvedValueOnce(
      roomEnvelope(rawRoom("room-b", { unreadCount: 2 })),
    );
    store.upsertRoomToTop(makeRoom("room-b"));
    messageIn("room-b");
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?roomId=room-b",
    );
    expect(store.getSnapshot().roomRows[0]?.unreadCount).toBe(2);
    store.detach();
  });

  it("reads current rows immediately: one-room answer for a room that left marks whole list stale", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a"), makeRoom("room-b")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    const inFlightRoomA = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(inFlightRoomA.promise);
    messageIn("room-a");
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?roomId=room-a",
    );

    // room-a disappears from current rows before the one-room answer lands
    // (without advancing latestAppliedRefresh).
    store.syncProps({
      rooms: [makeRoom("room-b")],
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
    });

    inFlightRoomA.resolve(roomEnvelope(rawRoom("room-a", { unreadCount: 5 })));
    await flushMicrotasks();

    // Because room-a is no longer in current rows, wholeList is marked stale,
    // so the next event for room-b fetches the whole list instead of one room.
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope([rawRoom("room-b", { unreadCount: 1 })]),
    );
    messageIn("room-b");
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(2);
    expect(fetchBackgroundJsonMock.mock.calls[1]?.[0]).toBe(
      "/api/chat/rooms?collection=active",
    );
    store.detach();
  });

  it("marks whole list stale on health flip before recovery read, and ignores repeated same health", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a"), makeRoom("room-b")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    // Calling setHealth with the same value does not mark wholeList stale.
    store.setHealth(true);
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      roomEnvelope(rawRoom("room-a", { unreadCount: 1 })),
    );
    messageIn("room-a");
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?roomId=room-a",
    );
    fetchBackgroundJsonMock.mockClear();

    // Now start an in-flight one-room read, queue room-b, then flip health
    // false -> true. Health flip marks wholeList before the recovery request.
    const inFlightRoomA = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(inFlightRoomA.promise);
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([
          rawRoom("room-a", { unreadCount: 2 }),
          rawRoom("room-b", { unreadCount: 3 }),
        ]),
        archived: pageEnvelope([]),
        invitations: pageEnvelope([]),
      }),
    );

    messageIn("room-a");
    messageIn("room-b");
    store.setHealth(false);
    store.setHealth(true);

    inFlightRoomA.resolve(roomEnvelope(rawRoom("room-a", { unreadCount: 2 })));
    await flushMicrotasks();

    const urls = fetchBackgroundJsonMock.mock.calls.map((call) => call[0]);
    expect(urls[0]).toBe("/api/chat/rooms?roomId=room-a");
    expect(urls.some((url) => url.includes("collection"))).toBe(true);
    expect(urls.filter((url) => url.includes("roomId="))).toHaveLength(1);
    store.detach();
  });

  // Interleaving 7: event during an in-flight read queues exactly one follow-up.
  it("interleaving 7: queues exactly one follow-up for events arriving during an in-flight read", async () => {
    const first = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(first.promise);

    const store = createAttachedStore();
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    // Three invalidations arrive while the first read is still in flight.
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope([rawRoom("fresh-room")]),
    );
    first.resolve(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("old-room")]),
        invitations: pageEnvelope([]),
      }),
    );
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "fresh-room",
    ]);
    store.detach();
  });

  // Interleaving 8: revocation during an invitation read does not cancel the invitation read.
  it("interleaving 8: revocation during an invitation read does not cancel the invitation read", async () => {
    const mountRead = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(mountRead.promise);

    const store = createAttachedStore({
      rooms: [makeRoom("room-a")],
    });
    await flushMicrotasks();

    revokeRoom("room-a");
    expect(store.getSnapshot().roomRows).toEqual([]);

    mountRead.resolve(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([rawInvitation("inv-keep")]),
      }),
    );
    await flushMicrotasks();

    // Active response predates the revocation so room-a stays gone, while
    // the invitation read is unaffected and lands.
    expect(store.getSnapshot().roomRows).toEqual([]);
    expect(store.getSnapshot().pendingRows.map((inv) => inv.id)).toEqual([
      "inv-keep",
    ]);
    store.detach();
  });

  // Interleaving 9: two messages for one room make one request at a time.
  it("interleaving 9: two messages for one room run one request at a time with one follow-up", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({ rooms: [makeRoom("room-a")] });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    messageIn("room-a");
    messageIn("room-a");
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?roomId=room-a",
    );

    first.resolve(roomEnvelope(rawRoom("room-a", { unreadCount: 1 })));
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().roomRows[0]?.unreadCount).toBe(1);

    second.resolve(roomEnvelope(rawRoom("room-a", { unreadCount: 2 })));
    await flushMicrotasks();
    expect(store.getSnapshot().roomRows[0]?.unreadCount).toBe(2);
    store.detach();
  });

  // Interleaving 12: revoked room hides at once, older list answer does not restore it,
  // a later read shows it, and the revocation starts no request.
  it("interleaving 12: hides revoked room immediately, blocks older read, allows later read, starts no GET", async () => {
    const earlierRead = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(earlierRead.promise);

    const store = createAttachedStore({
      rooms: [makeRoom("room-a"), makeRoom("room-b")],
    });
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    revokeRoom("room-a");
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "room-b",
    ]);
    // Revocation itself starts no request.
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    earlierRead.resolve(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
        invitations: pageEnvelope([]),
      }),
    );
    await flushMicrotasks();
    // Older list response must not restore room-a.
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "room-b",
    ]);

    // A later read after rejoin shows room-a again.
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
    );
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    await flushMicrotasks();
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "room-a",
      "room-b",
    ]);
    store.detach();
  });

  // Interleaving 13: read at t=0, active change at 100 ms, revocation at 200 ms,
  // a 429: the queued active read runs after the window.
  it("interleaving 13: queued active read after revocation and 429 runs once throttle window ends", async () => {
    const initialRead = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(initialRead.promise);

    const store = createAttachedStore({
      rooms: [makeRoom("room-a"), makeRoom("room-b")],
      healthy: true,
    });
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });

    await vi.advanceTimersByTimeAsync(100);
    revokeRoom("room-a");
    expect(store.getSnapshot().roomRows.map((room) => room.id)).toEqual([
      "room-b",
    ]);

    // Initial read answers with a 429 throttle window (30 s).
    noteChatReadThrottled(30);
    initialRead.resolve(null);
    await flushMicrotasks();

    // No read starts while throttled.
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope([rawRoom("room-b", { unreadCount: 4 })]),
    );
    await vi.advanceTimersByTimeAsync(45_000);
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().roomRows).toHaveLength(1);
    expect(store.getSnapshot().roomRows[0]?.unreadCount).toBe(4);
    store.detach();
  });

  // Prototype S2: a 429 from another chat reader blocks list reads and one-room reads.
  it("S2: a 429 from another chat reader blocks list reads and one-room reads until the window ends", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    // Another reader hit 429 for 30 s.
    noteChatReadThrottled(30);
    messageIn("room-a");
    notifyOrganizationChatRoomsChanged({ collections: ["archived"] });
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).not.toHaveBeenCalled();

    fetchBackgroundJsonMock.mockResolvedValueOnce(
      roomEnvelope(rawRoom("room-a", { unreadCount: 5 })),
    );
    fetchBackgroundJsonMock.mockResolvedValueOnce(pageEnvelope([]));
    await vi.advanceTimersByTimeAsync(45_000);
    await flushMicrotasks();

    const resumedUrls = fetchBackgroundJsonMock.mock.calls.map(([url]) => url);
    expect(resumedUrls).toContain("/api/chat/rooms?roomId=room-a");
    expect(resumedUrls).toContain("/api/chat/rooms?collection=archived");
    store.detach();
  });

  // Scheduler rules: > 3 stale rooms read whole list; gone room falls back; online marks whole list.
  it("scheduler rules: more than 3 stale rooms read the whole list", async () => {
    const rooms = [
      makeRoom("r1"),
      makeRoom("r2"),
      makeRoom("r3"),
      makeRoom("r4"),
      makeRoom("r5"),
    ];
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope(rooms.map((r) => rawRoom(r.id))),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({ rooms, healthy: true });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    const first = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(first.promise);
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope(rooms.map((r) => rawRoom(r.id, { unreadCount: 1 }))),
    );

    // r1 starts a one-room read; r2..r5 (4 rooms > MAX_SINGLE_ROOM_READS) queue behind it.
    messageIn("r1");
    messageIn("r2");
    messageIn("r3");
    messageIn("r4");
    messageIn("r5");

    first.resolve(roomEnvelope(rawRoom("r1")));
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(2);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?roomId=r1",
    );
    expect(fetchBackgroundJsonMock.mock.calls[1]?.[0]).toBe(
      "/api/chat/rooms?collection=active",
    );
    store.detach();
  });

  it("scheduler rules: a gone room falls back to the whole list with a new revision", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    const roomRead = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(roomRead.promise);
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      pageEnvelope([rawRoom("room-b", { unreadCount: 2 })]),
    );

    messageIn("room-a");
    // A local upsert happens while room-a is in flight; the fallback list read
    // gets a fresh revision so it is not dropped by the earlier upsert.
    store.upsertRoomToTop(makeRoom("room-c"));
    roomRead.resolve(roomEnvelope(null));
    await flushMicrotasks();

    expect(fetchBackgroundJsonMock.mock.calls[1]?.[0]).toBe(
      "/api/chat/rooms?collection=active",
    );
    expect(store.getSnapshot().roomRows.map((r) => r.id)).toEqual(["room-b"]);
    store.detach();
  });

  it("scheduler rules: online marks the whole list stale", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a"), makeRoom("room-b")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    const first = Promise.withResolvers<unknown>();
    fetchBackgroundJsonMock.mockReturnValueOnce(first.promise);
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a"), rawRoom("room-b")]),
        archived: pageEnvelope([]),
        invitations: pageEnvelope([]),
      }),
    );

    messageIn("room-a");
    messageIn("room-b");
    window.dispatchEvent(new Event("online"));

    first.resolve(roomEnvelope(rawRoom("room-a")));
    await flushMicrotasks();

    const urls = fetchBackgroundJsonMock.mock.calls.map((call) => call[0]);
    expect(urls[0]).toBe("/api/chat/rooms?roomId=room-a");
    expect(urls.some((url) => url.includes("collection"))).toBe(true);
    expect(urls.filter((url) => url.includes("roomId="))).toHaveLength(1);
    store.detach();
  });

  // Prototype "action attention": Pin or Mute answer keeps read state after a room read.
  it("action attention: replaceRoom from Pin or Mute keeps the read state after a room read", async () => {
    const initial = makeRoom("room-a", {
      unreadCount: 3,
      channelUnreadCount: 3,
    });
    const store = createChatListStore({
      rooms: [initial],
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
      currentUserId: "user-1",
      organizationId: "org-1",
      paintOnly: false,
      healthy: true,
    });
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a", { unreadCount: 3 })]),
        invitations: pageEnvelope([]),
      }),
    );
    store.attach({ organizationId: "org-1", currentUserId: "user-1" });
    await flushMicrotasks();

    // Reader opens and reads the room locally.
    window.dispatchEvent(
      new CustomEvent(ORGANIZATION_CHAT_ROOM_READ_EVENT, {
        detail: { roomId: "room-a" },
      }),
    );
    expect(store.getSnapshot().roomRows[0]?.unreadCount).toBe(0);

    // Pin/Mute server answer returns stale unreadCount: 3 with starredAt / mutedAt set.
    store.replaceRoom(
      makeRoom("room-a", {
        unreadCount: 3,
        channelUnreadCount: 3,
        starredAt: new Date(TIMESTAMP),
        mutedAt: new Date(TIMESTAMP),
      }),
    );

    const updated = store.getSnapshot().roomRows[0];
    expect(updated?.starredAt).toEqual(new Date(TIMESTAMP));
    expect(updated?.mutedAt).toEqual(new Date(TIMESTAMP));
    expect(updated?.unreadCount).toBe(0);
    store.detach();
  });

  // Rule 7: a failed whole-list read at 429 makes no second request before the next cadence.
  it("rule 7: a failed whole-list read at 429 makes no second request before the next cadence", async () => {
    fetchBackgroundJsonMock.mockResolvedValueOnce(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        invitations: pageEnvelope([]),
      }),
    );
    const store = createAttachedStore({
      rooms: [makeRoom("room-a")],
      healthy: true,
    });
    await flushMicrotasks();
    fetchBackgroundJsonMock.mockClear();

    // Whole-list read fails with a 30 s 429 throttle.
    fetchBackgroundJsonMock.mockImplementationOnce(async () => {
      noteChatReadThrottled(30);
      return null;
    });
    notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    // Passing the 30 s throttle window (45 s < 60 s healthy cadence) must NOT
    // trigger a second request: failed whole-list reads do not re-request.
    await vi.advanceTimersByTimeAsync(45_000);
    await flushMicrotasks();
    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);

    // Only at the 60 s healthy cadence does the next active read fire.
    fetchBackgroundJsonMock.mockResolvedValue(
      batchedEnvelope({
        active: pageEnvelope([rawRoom("room-a")]),
        archived: pageEnvelope([]),
        invitations: pageEnvelope([]),
      }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();
    const activeCalls = fetchBackgroundJsonMock.mock.calls.filter(([url]) =>
      url.includes("active"),
    );
    expect(activeCalls).toHaveLength(2);
    store.detach();
  });

  it("keeps unchanged collection array references when another collection updates", () => {
    const room = makeRoom("room-a");
    const store = createChatListStore({
      rooms: [room],
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
      currentUserId: "user-1",
      organizationId: "org-1",
      paintOnly: true,
      healthy: true,
    });
    const before = store.getSnapshot();
    const revision = beginRoomAttentionRefresh();
    expect(store.replaceAllRooms([room], revision)).toBe(true);
    const afterActive = store.getSnapshot();
    expect(afterActive.archivedRows).toBe(before.archivedRows);
    expect(afterActive.pendingRows).toBe(before.pendingRows);

    const archived = [makeRoom("arch-1")];
    store.setArchivedRows(archived);
    const afterArchived = store.getSnapshot();
    expect(afterArchived.roomRows).toBe(afterActive.roomRows);
    expect(afterArchived.archivedRows).toBe(archived);
    expect(afterArchived.pendingRows).toBe(afterActive.pendingRows);
  });

  it.todo(
    "interleaving 1 (same as main): workspace switch gap can land B's rows in A's still-mounted list",
  );
  it.todo(
    "interleaving 2 (same as main): membership lost mid-read needs Core to echo the scope",
  );
});
