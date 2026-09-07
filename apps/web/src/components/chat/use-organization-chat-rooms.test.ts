import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";

import {
  emptyListResult,
  listPendingMock,
  listRoomsMock,
  makeRoom,
  resetOrganizationChatListMocks,
} from "./__tests__/organization-chat-list-harness";
import { clearMembershipVisibleRoomsSnapshot } from "./membership-visible-rooms-store";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "./organization-chat-events";
import { clearRoomReadOverlays, rememberRoomRead } from "./room-read-overlay";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";

const NO_ROOMS: ChatRoom[] = [];
const NO_INVITATIONS: ChatRoomInvitation[] = [];

function channel(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return makeRoom({ ...overrides, id, kind: "channel", myAccess: "member" });
}

interface MountOptions {
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  paintOnly?: boolean;
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
}: MountOptions = {}) {
  return renderHook(
    (props: { rooms: ChatRoom[]; archivedRooms: ChatRoom[] }) =>
      useOrganizationChatRooms({
        rooms: props.rooms,
        archivedRooms: props.archivedRooms,
        pendingInvitations: NO_INVITATIONS,
        currentUserId: "user-1",
        organizationId: "org-1",
        paintOnly,
      }),
    { initialProps: { rooms, archivedRooms } },
  );
}

describe("useOrganizationChatRooms", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    clearRoomReadOverlays();
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
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

  it("refreshes from Core on mount, so a stale remount corrects itself", async () => {
    listRoomsMock.mockResolvedValue(emptyListResult([channel("fetched-1")]));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.roomRows.map((row) => row.id)).toEqual([
        "fetched-1",
      ]);
    });
  });

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
      result.current.replaceAllRooms([channel("fresh")]);
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

  it("reapplies the read overlay when it replaces the whole list", () => {
    const room = channel("overlaid", { unreadCount: 5 });
    const { result } = mount({ rooms: [room], paintOnly: true });

    rememberRoomRead({ ...room, unreadCount: 0 });

    act(() => {
      result.current.replaceAllRooms([room]);
    });

    // A stale fetch must not paint the room unread again.
    expect(result.current.roomRows[0]?.unreadCount).toBe(0);
  });
});
