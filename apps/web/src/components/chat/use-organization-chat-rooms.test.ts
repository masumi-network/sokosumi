import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import {
  noteChatReadThrottled,
  resetChatReadThrottleForTests,
} from "@/lib/chat/chat-read-throttle";
import {
  emptyListResult,
  getRoomMock,
  listPendingMock,
  listRoomsMock,
  makeRoom,
  resetOrganizationChatListMocks,
} from "./__tests__/organization-chat-list-harness";
import {
  clearMembershipVisibleRoomsSnapshot,
  getLatestMembershipVisibleRoomsSnapshot,
  hasLiveMembershipVisibleRoomsPublisher,
} from "./membership-visible-rooms-store";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "./organization-chat-events";
import {
  beginRoomAttentionChange,
  beginRoomAttentionRefresh,
  clearRoomReadOverlays,
  rememberRoomRead,
  settleRoomAttentionChange,
} from "./room-read-overlay";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";

const NO_ROOMS: ChatRoom[] = [];
const NO_INVITATIONS: ChatRoomInvitation[] = [];

let hasFocus: ReturnType<typeof vi.spyOn>;

/**
 * Leave the foreground, learn the active collection changed while away, and
 * come back. The invalidation reads at once (the tab title needs it); the
 * return then has nothing stale left, so the round is exactly one read.
 */
function invalidateWhileAwayAndReturn() {
  hasFocus.mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
      detail: { collections: ["active"] },
    }),
  );
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
}

function channel(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return makeRoom({ ...overrides, id, kind: "channel", myAccess: "member" });
}

interface MountOptions {
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  paintOnly?: boolean;
  organizationId?: string;
  currentUserId?: string;
}

interface RoomListProps {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  organizationId?: string;
  currentUserId?: string;
}

/**
 * The collections must keep the same identity across renders. The hook replaces
 * its rows whenever a collection is a new reference, so a fresh `[]` literal per
 * render would loop (React #301) — the hazard the list guards with its stable
 * empty default.
 */
function mount({
  rooms = NO_ROOMS,
  archivedRooms = NO_ROOMS,
  paintOnly = false,
  organizationId,
  currentUserId,
}: MountOptions = {}) {
  const initialProps: RoomListProps = {
    rooms,
    archivedRooms,
    organizationId,
    currentUserId,
  };
  return renderHook(
    (props: RoomListProps) =>
      useOrganizationChatRooms({
        rooms: props.rooms,
        archivedRooms: props.archivedRooms,
        pendingInvitations: NO_INVITATIONS,
        currentUserId: props.currentUserId ?? "user-1",
        organizationId: props.organizationId ?? "org-1",
        paintOnly,
      }),
    { initialProps },
  );
}

describe("useOrganizationChatRooms", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    clearRoomReadOverlays();
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
  });

  it("paints the rooms it was given without subscribing, when paintOnly", () => {
    const rooms = [channel("paint-1")];
    const { result } = mount({ rooms, paintOnly: true });

    expect(result.current.roomRows.map((row) => row.id)).toEqual(["paint-1"]);
    // Instant soft-nav (SOK-903) must not fetch, or the paint it exists to
    // avoid is the paint it causes.
    expect(listRoomsMock).not.toHaveBeenCalled();
    expect(listPendingMock).not.toHaveBeenCalled();
  });

  it("announces itself as the live list only while mounted and reading", () => {
    const painted = mount({ paintOnly: true });
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(false);
    painted.unmount();

    const live = mount();
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(true);
    live.unmount();
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(false);
  });

  it("refreshes from Core on mount, so a stale remount corrects itself", async () => {
    listRoomsMock.mockResolvedValue(emptyListResult([channel("fetched-1")]));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.roomRows.map((row) => row.id)).toEqual([
        "fetched-1",
      ]);
    });
  });

  it.each([true, false])(
    "retains fetched Direct read-only=%s while a stale mobile remount refresh is pending",
    async (isReadOnly) => {
      const original = makeRoom({
        id: "direct",
        kind: "direct",
        myAccess: "member",
        isReadOnly: !isReadOnly,
      });
      const seed = [original];
      const refreshed = { ...original, isReadOnly };
      listRoomsMock
        .mockResolvedValueOnce(emptyListResult([refreshed]))
        .mockReturnValue(new Promise(() => {}));
      const first = mount({ rooms: seed });
      await waitFor(() =>
        expect(first.result.current.roomRows[0]?.isReadOnly).toBe(isReadOnly),
      );
      first.unmount();

      const remounted = mount({ rooms: seed });
      expect(remounted.result.current.roomRows[0]?.isReadOnly).toBe(isReadOnly);
      expect(
        getLatestMembershipVisibleRoomsSnapshot()?.rooms[0]?.isReadOnly,
      ).toBe(isReadOnly);
    },
  );

  it("uses fresh server props instead of an earlier sidebar snapshot", async () => {
    const seed = [
      makeRoom({
        id: "direct",
        kind: "direct",
        myAccess: "member",
        isReadOnly: false,
      }),
    ];
    listRoomsMock
      .mockResolvedValueOnce(
        emptyListResult([{ ...seed[0], isReadOnly: true }]),
      )
      .mockReturnValue(new Promise(() => {}));
    const first = mount({ rooms: seed });
    await waitFor(() =>
      expect(first.result.current.roomRows[0]?.isReadOnly).toBe(true),
    );
    first.unmount();

    const fresh = mount({ rooms: [{ ...seed[0], isReadOnly: false }] });
    expect(fresh.result.current.roomRows[0]?.isReadOnly).toBe(false);
  });

  it.each([
    { organizationId: "org-2", currentUserId: "user-1" },
    { organizationId: "org-1", currentUserId: "user-2" },
  ])(
    "does not reuse a remount snapshot for $organizationId/$currentUserId",
    async (scope) => {
      const seed = [channel("seed")];
      listRoomsMock
        .mockResolvedValueOnce(emptyListResult([channel("private-snapshot")]))
        .mockReturnValue(new Promise(() => {}));
      const first = mount({ rooms: seed });
      await waitFor(() =>
        expect(first.result.current.roomRows[0]?.id).toBe("private-snapshot"),
      );
      first.unmount();
      const other = mount({ rooms: seed, ...scope });
      expect(other.result.current.roomRows[0]?.id).toBe("seed");
    },
  );

  it("replaces the rows when new props arrive", () => {
    const { result, rerender } = mount({
      rooms: [channel("first")],
      paintOnly: true,
    });

    expect(result.current.roomRows.map((row) => row.id)).toEqual(["first"]);

    rerender({ rooms: [channel("second")], archivedRooms: NO_ROOMS });

    expect(result.current.roomRows.map((row) => row.id)).toEqual(["second"]);
  });

  it("clears a room's unread when it reports itself read", async () => {
    const rooms = [
      channel("read-me", { unreadCount: 4, unreadMentionCount: 2 }),
    ];
    // The mount refresh replaces the rows, so the poll has to agree with the
    // seed or it clears the very room under test.
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    const { result } = mount({ rooms });

    await waitFor(() => {
      expect(result.current.roomRows).toHaveLength(1);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("organization-chat-room-read", {
          detail: { roomId: "read-me" },
        }),
      );
    });

    const row = result.current.roomRows.find((r) => r.id === "read-me");
    expect(row?.unreadCount).toBe(0);
    expect(row?.unreadMentionCount).toBe(0);
    expect(row?.markedUnread).toBe(false);
  });

  it("drops a room the control channel says the reader lost", async () => {
    const rooms = [channel("kept"), channel("revoked")];
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    const { result } = mount({ rooms });

    await waitFor(() => {
      expect(result.current.roomRows).toHaveLength(2);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
          detail: { removedRoomId: "revoked" },
        }),
      );
    });

    expect(result.current.roomRows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("moves a room to the top and drops its archived copy in one step", () => {
    const restored = channel("restored");
    const { result } = mount({
      rooms: [channel("other")],
      archivedRooms: [restored],
      paintOnly: true,
    });

    expect(result.current.archivedRows.map((row) => row.id)).toEqual([
      "restored",
    ]);

    act(() => {
      result.current.upsertRoomToTop(restored);
    });

    // A room is live or archived, never both.
    expect(result.current.roomRows.map((row) => row.id)).toEqual([
      "restored",
      "other",
    ]);
    expect(result.current.archivedRows).toEqual([]);
  });

  it("replaces rather than duplicates a room it already holds", () => {
    const room = channel("dupe");
    const { result } = mount({
      rooms: [room, channel("other")],
      paintOnly: true,
    });

    act(() => {
      result.current.upsertRoomToTop({ ...room, name: "renamed" });
    });

    expect(result.current.roomRows.map((row) => row.id)).toEqual([
      "dupe",
      "other",
    ]);
    expect(result.current.roomRows[0]?.name).toBe("renamed");
  });

  // Opening a Direct, joining a channel the reader is already in, creating or
  // restoring a room: each answers with the room, and none of them recounts
  // what is unread, so the counts on that answer are zeros that mean "not
  // counted", not "nothing unread".
  it("keeps what is unread on a room it already holds", () => {
    const unreadThread = {
      parentMessageId: "550e8400-e29b-41d4-a716-446655440b01",
      firstUnreadReplyId: "550e8400-e29b-41d4-a716-446655440c01",
      parentContent: "Vendor-wide rollout",
      unreadReplyCount: 2,
    };
    const room = {
      ...channel("held"),
      unreadCount: 5,
      channelUnreadCount: 3,
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [unreadThread],
      unreadMentionCount: 1,
    };
    const { result } = mount({ rooms: [room], paintOnly: true });

    act(() => {
      result.current.upsertRoomToTop({
        ...room,
        name: "renamed",
        unreadCount: 0,
        channelUnreadCount: 0,
        threadUnreadCount: 0,
        unreadThreadCount: 0,
        unreadThreads: [],
        unreadMentionCount: 0,
      });
    });

    expect(result.current.roomRows[0]).toMatchObject({
      name: "renamed",
      unreadCount: 5,
      channelUnreadCount: 3,
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [unreadThread],
      unreadMentionCount: 1,
    });
  });

  it("takes a room it did not hold as it comes", () => {
    const { result } = mount({ rooms: [], paintOnly: true });

    act(() => {
      result.current.upsertRoomToTop({ ...channel("fresh"), unreadCount: 0 });
    });

    expect(result.current.roomRows[0]).toMatchObject({
      id: "fresh",
      unreadCount: 0,
    });
  });

  it("swaps one room for a newer copy without moving it", () => {
    const room = channel("edited");
    const { result } = mount({
      rooms: [channel("first"), room, channel("last")],
      paintOnly: true,
    });

    act(() => {
      result.current.replaceRoom({ ...room, name: "renamed" });
    });

    expect(result.current.roomRows.map((row) => row.id)).toEqual([
      "first",
      "edited",
      "last",
    ]);
    expect(result.current.roomRows[1]?.name).toBe("renamed");
  });

  it("keeps a room the reader just marked unread unread", () => {
    const room = channel("marked");
    const { result } = mount({ rooms: [room], paintOnly: true });

    // The reader read the room first, so a read overlay is on file. Without
    // dropping it, the overlay would paint the room read again on the spot.
    rememberRoomRead(room);

    act(() => {
      result.current.replaceRoom({ ...room, markedUnread: true });
    });

    expect(result.current.roomRows[0]?.markedUnread).toBe(true);
  });

  it("replaces the whole live list with a freshly fetched one", () => {
    const { result } = mount({
      rooms: [channel("stale-1"), channel("stale-2")],
      paintOnly: true,
    });

    act(() => {
      result.current.replaceAllRooms(
        [channel("fresh")],
        beginRoomAttentionRefresh(),
      );
    });

    expect(result.current.roomRows.map((row) => row.id)).toEqual(["fresh"]);
  });

  it("reapplies the read overlay when it swaps one room", () => {
    const room = channel("overlaid", { unreadCount: 5 });
    const { result } = mount({ rooms: [room], paintOnly: true });

    // The reader marked the room read. Core has not caught up, so the copy the
    // list is handed still carries the old unread.
    rememberRoomRead({ ...room, unreadCount: 0 });

    act(() => {
      result.current.replaceRoom({ ...room, name: "renamed" });
    });

    expect(result.current.roomRows[0]?.name).toBe("renamed");
    expect(result.current.roomRows[0]?.unreadCount).toBe(0);
  });

  it("reapplies a read that completed after a list fetch started", () => {
    const room = channel("overlaid", { unreadCount: 5 });
    const { result } = mount({ rooms: [room], paintOnly: true });

    const request = beginRoomAttentionRefresh();
    rememberRoomRead({ ...room, unreadCount: 0 });

    act(() => {
      result.current.replaceAllRooms([room], request);
    });

    // A stale fetch must not paint the room unread again.
    expect(result.current.roomRows[0]?.unreadCount).toBe(0);
  });
});

describe("authoritative sidebar refresh", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    clearRoomReadOverlays();
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates unread while an invitation request stays pending", async () => {
    const original = channel("room");
    listRoomsMock.mockResolvedValue(
      emptyListResult([{ ...original, unreadCount: 3 }]),
    );
    listPendingMock.mockReturnValue(new Promise(() => {}));
    const { result } = mount({ rooms: [original] });

    await waitFor(() =>
      expect(result.current.roomRows[0]?.unreadCount).toBe(3),
    );
  });

  it("keeps the last rows after a rejected request and retries on foreground return", async () => {
    const original = channel("room");
    listRoomsMock.mockRejectedValueOnce(new Error("network offline"));
    const { result } = mount({ rooms: [original] });
    await act(async () => undefined);
    expect(result.current.roomRows).toEqual([original]);

    listRoomsMock.mockResolvedValue(
      emptyListResult([{ ...original, unreadCount: 2 }]),
    );
    await act(async () => invalidateWhileAwayAndReturn());
    expect(result.current.roomRows[0]?.unreadCount).toBe(2);
  });

  it("accepts an older active response when a newer refresh only loads invitations", async () => {
    const original = channel("room");
    const older = Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ok: false });
    const { result } = mount({ rooms: [original] });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () =>
      older.resolve(emptyListResult([{ ...original, unreadCount: 4 }])),
    );
    expect(result.current.roomRows[0]?.unreadCount).toBe(4);
  });

  it("never overlaps a slow read and re-arms the fallback poll after it completes", async () => {
    vi.useFakeTimers();
    const original = channel("slow-room");
    const responseDelayMs = 16_000;
    listRoomsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(emptyListResult([{ ...original, unreadCount: 4 }])),
            responseDelayMs,
          );
        }),
    );
    const { result, unmount } = mount({ rooms: [original] });
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      // Mount read (0–16s), 15s fallback timer, second read (31–47s), timer.
      expect(listRoomsMock).toHaveBeenCalledTimes(2);
      expect(result.current.roomRows[0]?.unreadCount).toBe(4);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("accepts remote Mark unread at the same timestamp and retains it on remount", async () => {
    const original = channel("room");
    rememberRoomRead(original);
    listRoomsMock.mockResolvedValue(
      emptyListResult([{ ...original, markedUnread: true }]),
    );
    const { result, rerender } = mount({ rooms: [original] });

    await waitFor(() =>
      expect(result.current.roomRows[0]?.markedUnread).toBe(true),
    );
    rerender({ rooms: [{ ...original }], archivedRooms: NO_ROOMS });
    expect(result.current.roomRows[0]?.markedUnread).toBe(true);
  });

  it("accepts a remote Thread Look count decrease without new activity", async () => {
    const original = channel("room", { unreadCount: 2 });
    rememberRoomRead(original);
    listRoomsMock.mockResolvedValue(
      emptyListResult([{ ...original, unreadCount: 0 }]),
    );
    const { result } = mount({ rooms: [original] });

    await waitFor(() =>
      expect(result.current.roomRows[0]?.unreadCount).toBe(0),
    );
  });

  it("queues one follow-up read behind an in-flight read instead of overlapping", async () => {
    const original = channel("room");
    const older = Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    const newer = Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = mount({ rooms: [original] });
    await act(async () => {
      for (let i = 0; i < 3; i += 1) {
        window.dispatchEvent(
          new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
            detail: { collections: ["active"] },
          }),
        );
      }
    });
    expect(listRoomsMock).toHaveBeenCalledTimes(1);

    await act(async () => older.resolve(emptyListResult([original])));
    expect(listRoomsMock).toHaveBeenCalledTimes(2);
    await act(async () =>
      newer.resolve(emptyListResult([{ ...original, unreadCount: 1 }])),
    );
    expect(result.current.roomRows[0]?.unreadCount).toBe(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(2);
  });

  it("refetches only the collections an invalidation names", async () => {
    mount();
    await act(async () => undefined);
    listRoomsMock.mockClear();
    listPendingMock.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
          detail: { collections: ["invitations"] },
        }),
      );
    });
    expect(listPendingMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("reads an active invalidation while hidden, so the tab title can show the unread room", async () => {
    // A message in another room reaches the sidebar as an active-collection
    // invalidation. The reader is not looking at the tab; the title counter
    // is the only thing that can tell them. The read must not wait for focus.
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const { result } = mount({ rooms: [channel("other-1")] });
    await act(async () => undefined);
    listRoomsMock.mockClear();
    listRoomsMock.mockResolvedValue(
      emptyListResult([channel("other-1", { unreadCount: 1 })]),
    );

    await act(async () => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
          detail: { collections: ["active"] },
        }),
      );
    });

    expect(listRoomsMock).toHaveBeenCalledTimes(1);
    expect(result.current.roomRows[0]?.unreadCount).toBe(1);
  });

  it("does not restore a removed room from an older poll", async () => {
    const original = channel("removed");
    const pending = Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock.mockReturnValueOnce(pending.promise);
    const { result } = mount({ rooms: [original] });
    act(() =>
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
          detail: { removedRoomId: original.id },
        }),
      ),
    );
    expect(result.current.roomRows).toEqual([]);
    await act(async () => pending.resolve(emptyListResult([original])));
    expect(result.current.roomRows).toEqual([]);
  });

  it.each([
    { trigger: "focus", organizationId: "org-2", currentUserId: "user-1" },
    { trigger: "focus", organizationId: "org-1", currentUserId: "user-2" },
    {
      trigger: ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      organizationId: "org-2",
      currentUserId: "user-1",
    },
    {
      trigger: ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      organizationId: "org-1",
      currentUserId: "user-2",
    },
  ])(
    "cancels $trigger requests after switching to $organizationId/$currentUserId",
    async ({ trigger, organizationId, currentUserId }) => {
      const original = channel("previous-room");
      const replacement = channel("current-room");
      const pending =
        Promise.withResolvers<ReturnType<typeof emptyListResult>>();
      listRoomsMock
        .mockResolvedValueOnce(emptyListResult([original]))
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ ok: false });
      const { result, rerender } = mount({ rooms: [original] });
      await act(async () => undefined);
      await act(async () => {
        if (trigger === "focus") {
          invalidateWhileAwayAndReturn();
        } else {
          window.dispatchEvent(new Event(trigger));
        }
      });
      rerender({
        rooms: [replacement],
        archivedRooms: NO_ROOMS,
        organizationId,
        currentUserId,
      });
      await act(async () => pending.resolve(emptyListResult([original])));
      expect(result.current.roomRows).toEqual([replacement]);
    },
  );

  it("keeps the joined room when an invitation refresh overtakes a pending poll", async () => {
    const pendingPoll =
      Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock.mockReturnValue(pendingPoll.promise);
    const { result } = mount();
    const joined = channel("joined");
    act(() => {
      result.current.replaceAllRooms([joined], beginRoomAttentionRefresh());
    });

    await act(async () => pendingPoll.resolve(emptyListResult()));
    expect(result.current.roomRows.map((room) => room.id)).toEqual(["joined"]);
  });

  it.each(["joined", "updated"])(
    "keeps a %s room payload when an older poll finishes last",
    async (change) => {
      const original = channel("room");
      const staleRooms = change === "joined" ? [] : [original];
      const pendingPoll =
        Promise.withResolvers<ReturnType<typeof emptyListResult>>();
      listRoomsMock.mockReturnValueOnce(pendingPoll.promise);
      const { result } = mount({ rooms: staleRooms });
      const updated = { ...original, name: "New room name" };

      act(() => {
        window.dispatchEvent(
          new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
            detail: { room: updated },
          }),
        );
      });
      expect(result.current.roomRows).toEqual([updated]);

      await act(async () => pendingPoll.resolve(emptyListResult(staleRooms)));
      expect(result.current.roomRows).toEqual([updated]);

      const refreshed = { ...updated, name: "Later room name" };
      listRoomsMock.mockResolvedValue(emptyListResult([refreshed]));
      await act(async () => invalidateWhileAwayAndReturn());
      expect(result.current.roomRows).toEqual([refreshed]);
    },
  );

  it("protects a read completed while the mount fetch was in flight", async () => {
    const original = channel("room", { unreadCount: 5 });
    const response =
      Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock.mockReturnValue(response.promise);
    const { result } = mount({ rooms: [original] });
    const readRoom = { ...original, unreadCount: 2 };
    const token = beginRoomAttentionChange(readRoom);
    settleRoomAttentionChange(original.id, token, readRoom);

    await act(async () => response.resolve(emptyListResult([original])));
    expect(result.current.roomRows[0]?.unreadCount).toBe(2);
  });

  it("keeps pending reads across polling and accepts the next fetch after completion", async () => {
    const original = channel("room", { unreadCount: 5 });
    const readRoom = { ...original, unreadCount: 0 };
    const token = beginRoomAttentionChange(readRoom);
    listRoomsMock.mockResolvedValue(emptyListResult([original]));
    const { result } = mount({ rooms: [original] });
    await act(async () => undefined);
    expect(result.current.roomRows[0]?.unreadCount).toBe(0);

    settleRoomAttentionChange(original.id, token, readRoom);
    listRoomsMock.mockResolvedValue(
      emptyListResult([{ ...original, unreadCount: 1 }]),
    );
    await act(async () => invalidateWhileAwayAndReturn());
    expect(result.current.roomRows[0]?.unreadCount).toBe(1);
  });
});

/** A message event as the control channel hands it over: Core names the room. */
function messageIn(roomId: string) {
  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
      detail: { collections: ["active"], roomId },
    }),
  );
}

describe("a message event that names its room", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    clearRoomReadOverlays();
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetChatReadThrottleForTests();
    act(() => setAblyConnectionHealthy(false));
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
  });

  async function mountListed(...ids: string[]) {
    const rooms = ids.map((id) => channel(id));
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    const mounted = mount({ rooms });
    await act(async () => undefined);
    listRoomsMock.mockClear();
    return mounted;
  }

  it("reads that room alone and leaves the other rows as they were", async () => {
    const { result } = await mountListed("room-a", "room-b");
    const untouched = result.current.roomRows[1];
    getRoomMock.mockResolvedValue(channel("room-a", { unreadCount: 2 }));

    await act(async () => messageIn("room-a"));

    expect(getRoomMock).toHaveBeenCalledExactlyOnceWith("room-a");
    expect(listRoomsMock).not.toHaveBeenCalled();
    expect(result.current.roomRows.map((room) => room.unreadCount)).toEqual([
      2, 0,
    ]);
    expect(result.current.roomRows[1]).toBe(untouched);

    // The next event reads its own room only, not the one already read.
    getRoomMock.mockClear();
    await act(async () => messageIn("room-b"));
    expect(getRoomMock).toHaveBeenCalledExactlyOnceWith("room-b");
  });

  it("reads the whole list for a room it does not list yet", async () => {
    const { result } = await mountListed("room-a");
    listRoomsMock.mockResolvedValue(
      emptyListResult([channel("room-a"), channel("room-new")]),
    );

    await act(async () => messageIn("room-new"));

    expect(getRoomMock).not.toHaveBeenCalled();
    expect(result.current.roomRows.map((room) => room.id)).toEqual([
      "room-a",
      "room-new",
    ]);
  });

  it("reads the whole list when the reader can no longer open the room", async () => {
    const { result } = await mountListed("room-a", "room-b");
    getRoomMock.mockResolvedValue("gone");
    listRoomsMock.mockResolvedValue(emptyListResult([channel("room-b")]));

    await act(async () => messageIn("room-a"));

    expect(getRoomMock).toHaveBeenCalledExactlyOnceWith("room-a");
    expect(result.current.roomRows.map((room) => room.id)).toEqual(["room-b"]);
  });

  it("reads the whole list when an event naming no room is waiting with it", async () => {
    await mountListed("room-a", "room-b");
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);

    // Both wait behind the read in flight, and one of them names no room.
    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
          detail: { collections: ["active"] },
        }),
      );
    });
    await act(async () => first.resolve(channel("room-a")));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("reads the whole list once more rooms are stale than it reads singly", async () => {
    await mountListed("room-a", "room-b", "room-c", "room-d", "room-e");
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);

    // The first read is in flight; four more rooms queue behind it.
    await act(async () => {
      messageIn("room-a");
      for (const id of ["room-b", "room-c", "room-d", "room-e"]) messageIn(id);
    });
    expect(listRoomsMock).not.toHaveBeenCalled();
    await act(async () => first.resolve(channel("room-a")));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a room read when the reader read it while the room was being fetched", async () => {
    const { result } = await mountListed("room-a");
    const pending = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValue(pending.promise);

    await act(async () => messageIn("room-a"));
    act(() => rememberRoomRead(channel("room-a", { unreadCount: 0 })));
    await act(async () =>
      pending.resolve(channel("room-a", { unreadCount: 3 })),
    );

    expect(result.current.roomRows[0]?.unreadCount).toBe(0);
  });

  it("drops a room read that a newer copy of the room overtook", async () => {
    const { result } = await mountListed("room-a");
    const pending = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValue(pending.promise);

    await act(async () => messageIn("room-a"));
    act(() =>
      result.current.upsertRoomToTop(channel("room-a", { name: "Renamed" })),
    );
    await act(async () => pending.resolve(channel("room-a", { name: "Old" })));

    expect(result.current.roomRows[0]?.name).toBe("Renamed");
  });

  it("reads as many stale rooms singly as the limit allows, in one pass", async () => {
    const { result } = await mountListed(
      "room-a",
      "room-b",
      "room-c",
      "room-d",
    );
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);
    getRoomMock.mockImplementation(async (id: string) =>
      channel(id, { unreadCount: 5 }),
    );

    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
      messageIn("room-c");
      messageIn("room-d");
    });
    await act(async () => first.resolve(channel("room-a")));

    expect(listRoomsMock).not.toHaveBeenCalled();
    expect(result.current.roomRows.map((room) => room.unreadCount)).toEqual([
      0, 5, 5, 5,
    ]);
  });

  it("keeps the workspace logo and website, which Core loads for the list only", async () => {
    const listed = channel("room-a", {
      organizationLogo: "logo.png",
      organizationWebsiteUrl: "https://acme.test",
    });
    listRoomsMock.mockResolvedValue(emptyListResult([listed]));
    const { result } = mount({ rooms: [listed] });
    await act(async () => undefined);
    getRoomMock.mockResolvedValue(channel("room-a", { unreadCount: 1 }));

    await act(async () => messageIn("room-a"));

    expect(result.current.roomRows[0]).toMatchObject({
      unreadCount: 1,
      organizationLogo: "logo.png",
      organizationWebsiteUrl: "https://acme.test",
    });
  });

  it("reads the whole list on recovery even while a named room waits", async () => {
    act(() => setAblyConnectionHealthy(true));
    await mountListed("room-a", "room-b");
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);

    // Room B and the recovery read both wait behind the read in flight.
    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
    });
    act(() => setAblyConnectionHealthy(false));
    act(() => setAblyConnectionHealthy(true));
    await act(async () => first.resolve(channel("room-a")));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("reads the whole list for a new workspace, whatever the last one left waiting", async () => {
    const rooms = [channel("room-a"), channel("room-b")];
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    const { rerender } = mount({ rooms, organizationId: "org-1" });
    await act(async () => undefined);
    listRoomsMock.mockClear();
    getRoomMock.mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
    });
    await act(async () =>
      rerender({ rooms, archivedRooms: NO_ROOMS, organizationId: "org-2" }),
    );

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("waits out a throttle instead of asking for the whole list inside it", async () => {
    vi.useFakeTimers();
    // Healthy, so the only timer left is a minute out: the read at the end
    // of the window has to be the one this asked for.
    act(() => setAblyConnectionHealthy(true));
    await mountListed("room-a");
    getRoomMock.mockImplementation(async () => {
      noteChatReadThrottled(30);
      return null;
    });

    await act(async () => messageIn("room-a"));
    expect(listRoomsMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("applies the fallback list read after a change made during the room read", async () => {
    const { result } = await mountListed("room-a");
    const pending = Promise.withResolvers<ChatRoom | "gone">();
    getRoomMock.mockReturnValue(pending.promise);
    listRoomsMock.mockResolvedValue(
      emptyListResult([channel("room-a", { unreadCount: 4 })]),
    );

    await act(async () => messageIn("room-a"));
    act(() => result.current.upsertRoomToTop(channel("room-c")));
    await act(async () => pending.resolve("gone"));

    expect(
      result.current.roomRows.find((room) => room.id === "room-a")?.unreadCount,
    ).toBe(4);
  });

  it("reads the whole list when the browser comes back online while a named room waits", async () => {
    await mountListed("room-a", "room-b");
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);

    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => first.resolve(channel("room-a")));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("still owes the whole list after a whole-list read failed", async () => {
    await mountListed("room-a");
    listRoomsMock.mockResolvedValueOnce({ ok: false });

    await act(async () => messageIn("room-unlisted"));
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
    await act(async () => messageIn("room-a"));

    expect(getRoomMock).not.toHaveBeenCalled();
    expect(listRoomsMock).toHaveBeenCalledTimes(2);
  });

  it("reads the whole list after a room read was dropped", async () => {
    const { result } = await mountListed("room-a");
    const pending = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(pending.promise);

    await act(async () => messageIn("room-a"));
    act(() => result.current.upsertRoomToTop(channel("room-c")));
    await act(async () => pending.resolve(channel("room-a")));
    await act(async () => messageIn("room-c"));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("does not follow a failed room read with a list read that would fail too", async () => {
    await mountListed("room-a");
    getRoomMock.mockResolvedValueOnce(null);

    await act(async () => messageIn("room-a"));
    expect(listRoomsMock).not.toHaveBeenCalled();

    // The list is owed, so the next event reads it and not the room.
    await act(async () => messageIn("room-a"));
    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("lets a whole-list read that started earlier still land", async () => {
    const { result } = await mountListed("room-a");
    const earlier = beginRoomAttentionRefresh();
    getRoomMock.mockResolvedValue(channel("room-a"));

    await act(async () => messageIn("room-a"));
    act(() =>
      result.current.replaceAllRooms(
        [channel("room-a"), channel("room-b")],
        earlier,
      ),
    );

    expect(result.current.roomRows.map((room) => room.id)).toEqual([
      "room-a",
      "room-b",
    ]);
  });

  it("reads the whole list when one of several rooms is gone", async () => {
    await mountListed("room-a", "room-b", "room-c");
    const first = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(first.promise);
    getRoomMock.mockImplementation(async (id: string) =>
      id === "room-b" ? "gone" : channel(id),
    );

    await act(async () => {
      messageIn("room-a");
      messageIn("room-b");
      messageIn("room-c");
    });
    await act(async () => first.resolve(channel("room-a")));

    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("owes the whole list again after an earlier list read put an older row back", async () => {
    const { result } = await mountListed("room-a");
    const earlier = beginRoomAttentionRefresh();
    getRoomMock.mockResolvedValue(channel("room-a"));

    await act(async () => messageIn("room-a"));
    act(() => result.current.replaceAllRooms([channel("room-a")], earlier));
    getRoomMock.mockClear();
    await act(async () => messageIn("room-a"));

    expect(getRoomMock).not.toHaveBeenCalled();
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("still owes the whole list when its answer was dropped", async () => {
    const { result } = await mountListed("room-a");
    const pending = Promise.withResolvers<ReturnType<typeof emptyListResult>>();
    listRoomsMock.mockReturnValueOnce(pending.promise);

    await act(async () => messageIn("room-unlisted"));
    act(() => result.current.upsertRoomToTop(channel("room-c")));
    await act(async () =>
      pending.resolve(emptyListResult([channel("room-a")])),
    );
    await act(async () => messageIn("room-a"));

    expect(getRoomMock).not.toHaveBeenCalled();
    expect(listRoomsMock).toHaveBeenCalledTimes(2);
  });

  it("owes the whole list when the room left the rows during its read", async () => {
    const rooms = [channel("room-a"), channel("room-b")];
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    const { rerender } = mount({ rooms });
    await act(async () => undefined);
    listRoomsMock.mockClear();
    const pending = Promise.withResolvers<ChatRoom>();
    getRoomMock.mockReturnValueOnce(pending.promise);

    await act(async () => messageIn("room-a"));
    // New server props without the room: no revision moves.
    await act(async () =>
      rerender({ rooms: [channel("room-b")], archivedRooms: NO_ROOMS }),
    );
    await act(async () => pending.resolve(channel("room-a")));
    await act(async () => messageIn("room-b"));

    expect(getRoomMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("still reads the whole list once per recovery interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await mountListed("room-a");
    getRoomMock.mockResolvedValue(channel("room-a"));

    await act(async () => messageIn("room-a"));
    expect(listRoomsMock).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 60_000);
    await act(async () => messageIn("room-a"));
    expect(listRoomsMock).toHaveBeenCalledTimes(1);

    await act(async () => messageIn("room-a"));
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });
});
