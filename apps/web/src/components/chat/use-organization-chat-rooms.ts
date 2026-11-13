"use client";

import type {
  ChatRoom,
  ChatRoomInvitation,
  StarredChatRoomOrder,
} from "@sokosumi/core-client";
import type { ChatRoomCollection } from "@sokosumi/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";
import { withPinnedOrder } from "./chat-room-activity-sort";
import {
  fetchSidebarRoom,
  fetchSidebarRoomCollection,
} from "./fetch-sidebar-room-collection";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
} from "./membership-visible-rooms-store";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "./organization-chat-events";
import { keepRoomUnreadState } from "./room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "./room-read-overlay";
import {
  CHAT_HEALTHY_REFRESH_MS,
  useChatRefreshScheduler,
} from "./use-chat-refresh-scheduler";

/**
 * Most rooms one active read fetches singly. Past this the whole list is one
 * request and the single reads are several.
 */
const MAX_SINGLE_ROOM_READS = 3;

/** Poll cadence per collection while the Ably connection is unavailable. */
const ORGANIZATION_CHAT_FALLBACK_MS = 15_000;

interface UseOrganizationChatRoomsOptions {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
}

/**
 * Holds the chat sidebar's three room collections: the prop hand-off from RSC
 * and every path that can change the rows behind the reader's back (the
 * scheduled recovery read, foreground return, room-read, and the rooms-changed
 * control event). Each collection is its own scheduled read (SOK-986): an
 * invalidation naming only `archived` never re-reads the other two, timer
 * reads pause while the tab is hidden or unfocused, and a healthy Ably
 * connection slows recovery to once a minute. An invalidation still reads
 * while away: the live rows feed the tab title's unread count, which is
 * the one signal a reader who is not looking at the tab gets.
 *
 * Rendering and room actions live in the components. Room actions still write
 * the archived and pending collections through the setters this returns; the
 * live rows are the exception, because the read overlay has to be reapplied on
 * every write and that rule stays here. `paintOnly` mounts (SOK-903 instant
 * soft-nav) skip every subscription, so they paint the props they were given
 * and nothing else.
 *
 * The live rows are published to the membership-visible store on every change.
 * Chat surfaces that render without mounting the sidebar read them back from
 * there, the tab-title unread count among them.
 *
 * The three collections must keep their identity across renders. A new array
 * reference means new props, and the rows are replaced, so a caller passing a
 * fresh `[]` literal per render loops (React #301). That is what the list's
 * stable empty invitations default is for.
 */
export function useOrganizationChatRooms({
  rooms,
  archivedRooms,
  pendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
}: UseOrganizationChatRoomsOptions) {
  const hasOrganization = Boolean(organizationId);
  const latestAppliedRefreshRef = useRef(0);
  const latestRoomSwapRef = useRef(0);
  const latestArchivedRefreshRef = useRef(0);
  const latestInvitationsRefreshRef = useRef(0);
  const [roomRows, setRoomRows] = useState(() => {
    const snapshot = getLatestMembershipVisibleRoomsSnapshot();
    // Closing the mobile Sheet unmounts this list. Its unchanged RSC seed must
    // not replace a roster already fetched in this session while Core refreshes.
    const remountRooms =
      !paintOnly &&
      snapshot?.organizationId === organizationId &&
      snapshot.currentUserId === currentUserId &&
      snapshot.sourceRooms === rooms
        ? [...snapshot.rooms]
        : rooms;
    return applyRoomReadOverlays(remountRooms);
  });
  const [archivedRows, setArchivedRows] = useState(archivedRooms);
  const [pendingRows, setPendingRows] = useState(pendingInvitations);
  const [prevRooms, setPrevRooms] = useState(rooms);
  const [prevArchivedRooms, setPrevArchivedRooms] = useState(archivedRooms);
  const [prevPendingInvitations, setPrevPendingInvitations] =
    useState(pendingInvitations);

  // Replace local list when RSC props change (full membership-visible set).
  if (rooms !== prevRooms) {
    setPrevRooms(rooms);
    setRoomRows(applyRoomReadOverlays(rooms));
  }
  if (archivedRooms !== prevArchivedRooms) {
    setPrevArchivedRooms(archivedRooms);
    setArchivedRows(archivedRooms);
  }
  if (pendingInvitations !== prevPendingInvitations) {
    setPrevPendingInvitations(pendingInvitations);
    setPendingRows(pendingInvitations);
  }

  /**
   * Put a room at the top of the live list, replacing any row already there.
   * What was unread on that row stays: the answers that land here do not
   * count it.
   *
   * The archived copy goes at the same time: a room is live or archived, never
   * both, so the two collections cannot be updated apart without the room
   * appearing twice.
   */
  const upsertRoomToTop = useCallback((room: ChatRoom) => {
    latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
    latestArchivedRefreshRef.current = latestAppliedRefreshRef.current;
    setRoomRows((current) => {
      const held = current.find((row) => row.id === room.id);
      const without = current.filter((row) => row.id !== room.id);
      return applyRoomReadOverlays([
        keepRoomUnreadState(held, room),
        ...without,
      ]);
    });
    setArchivedRows((current) => current.filter((row) => row.id !== room.id));
  }, []);

  /**
   * Swap one room in the live list for a newer copy of itself.
   *
   * Mark unread retains the new attention for a later remount with stale
   * props. The action caller owns its pending operation and rollback.
   */
  const replaceRoom = useCallback((updated: ChatRoom) => {
    if (updated.markedUnread) {
      rememberRoomRead(updated);
    }
    setRoomRows((current) =>
      applyRoomReadOverlays(
        current.map((room) => (room.id === updated.id ? updated : room)),
      ),
    );
  }, []);

  /** Write a pinned order's `starredAt` sort keys onto the live list. */
  const applyPinnedOrder = useCallback((order: StarredChatRoomOrder[]) => {
    // A list fetch already in flight predates this order; drop it on arrival.
    latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
    setRoomRows((current) => withPinnedOrder(current, order));
  }, []);

  /**
   * Replace the whole live list with a freshly fetched one. False when a
   * newer change to the list overtook the read and it was dropped.
   *
   * Either way the list can now be behind something: a dropped read never
   * landed, and one that started before a one-room read puts that room's
   * older copy back. Both leave the whole list owed.
   */
  const replaceAllRooms = useCallback(
    (rooms: ChatRoom[], requestRevision: number): boolean => {
      if (requestRevision < latestAppliedRefreshRef.current) {
        staleActiveRef.current.wholeList = true;
        return false;
      }
      if (requestRevision < latestRoomSwapRef.current) {
        staleActiveRef.current.wholeList = true;
      }
      latestAppliedRefreshRef.current = requestRevision;
      setRoomRows(reconcileRoomAttention(rooms, requestRevision));
      return true;
    },
    [],
  );

  /**
   * Swap listed rooms for fresh copies of themselves, by the same attention
   * rule as a whole-list read. A room no longer listed is left out. False
   * when a newer change to the list overtook the read and it was dropped.
   *
   * It leaves the list's own revision where it was. A whole-list read that
   * started earlier (a failed pin reorder reloading, say) still has rows this
   * one did not read, so it must land; `replaceAllRooms` then owes a newer
   * list for the room this one swapped.
   */
  const replaceListedRooms = useCallback(
    (fresh: ChatRoom[], requestRevision: number): boolean => {
      if (requestRevision < latestAppliedRefreshRef.current) return false;
      latestRoomSwapRef.current = requestRevision;
      const freshById = new Map(
        reconcileRoomAttention(fresh, requestRevision).map((room) => [
          room.id,
          room,
        ]),
      );
      setRoomRows((current) =>
        current.map((row) => {
          const room = freshById.get(row.id);
          // Core loads the workspace logo and website for the list only.
          return room
            ? {
                ...room,
                organizationLogo: row.organizationLogo,
                organizationWebsiteUrl: row.organizationWebsiteUrl,
              }
            : row;
        }),
      );
      return true;
    },
    [],
  );

  /**
   * What the next active read has to fetch. A message event names its room,
   * and a listed room can be read alone (the list is every room the reader
   * holds, up to fifty pages of it). Anything else needs the whole list: a
   * room not listed yet, an event naming none, and the reads that exist to
   * find a lost event: mount, a workspace or user switch, recovery and coming
   * back online. Those ask for the whole list below, because a room named
   * while one of them waits would otherwise turn it into a one-room read.
   *
   * Every read re-arms the recovery timer, so in a busy workspace the timer
   * never fires. The whole list is still read once per recovery interval:
   * that read is what finds a room whose event was lost.
   */
  const staleActiveRef = useRef({ rooms: new Set<string>(), wholeList: false });
  const wholeListReadAtRef = useRef(0);
  const roomRowsRef = useRef(roomRows);
  roomRowsRef.current = roomRows;
  const requestActiveRef = useRef(() => {});

  /** Each collection recovers on its own; a failed read keeps the last rows. */
  const refreshActive = useCallback(
    async (isCurrent: () => boolean) => {
      const stale = staleActiveRef.current;
      const roomIds = stale.wholeList ? [] : [...stale.rooms];
      staleActiveRef.current = { rooms: new Set(), wholeList: false };
      let requestRevision = beginRoomAttentionRefresh();
      if (
        roomIds.length > 0 &&
        roomIds.length <= MAX_SINGLE_ROOM_READS &&
        Date.now() - wholeListReadAtRef.current < CHAT_HEALTHY_REFRESH_MS
      ) {
        const fresh = await Promise.all(roomIds.map(fetchSidebarRoom));
        if (!isCurrent()) return;
        const answered = fresh.filter((room) => room !== null);
        if (answered.length < fresh.length) {
          // A read that failed says nothing about the room, and the list
          // would fail the same way. It stays owed, as a failed list read
          // does. A throttle is the one failure with an end, so that waits
          // out the window like any other read.
          staleActiveRef.current.wholeList = true;
          if (chatReadThrottleResumeInMs() > 0) requestActiveRef.current();
          return;
        }
        const rooms = answered.filter((room) => room !== "gone");
        if (rooms.length === answered.length) {
          // A dropped answer leaves its room stale with nothing to say so.
          // The next read of any kind then takes the whole list.
          // So does an answer for a room that left the rows meanwhile.
          const listed = rooms.every((room) =>
            roomRowsRef.current.some((row) => row.id === room.id),
          );
          if (!replaceListedRooms(rooms, requestRevision) || !listed) {
            staleActiveRef.current.wholeList = true;
          }
          return;
        }
        // A room the reader can no longer open has left the list. The list
        // read starts now, so a change made during the room reads predates it.
        requestRevision = beginRoomAttentionRefresh();
      }
      const wholeListReadAt = Date.now();
      const page = await fetchSidebarRoomCollection("active");
      if (!isCurrent()) return;
      if (!page) {
        // Whatever asked for the whole list is still owed it.
        staleActiveRef.current.wholeList = true;
        return;
      }
      wholeListReadAtRef.current = wholeListReadAt;
      replaceAllRooms(page.rooms, requestRevision);
    },
    [replaceAllRooms, replaceListedRooms],
  );
  const refreshArchived = useCallback(async (isCurrent: () => boolean) => {
    const requestRevision = beginRoomAttentionRefresh();
    const page = await fetchSidebarRoomCollection("archived");
    if (
      !isCurrent() ||
      !page ||
      requestRevision < latestArchivedRefreshRef.current
    )
      return;
    latestArchivedRefreshRef.current = requestRevision;
    setArchivedRows(page.rooms);
  }, []);
  const refreshInvitations = useCallback(async (isCurrent: () => boolean) => {
    const requestRevision = beginRoomAttentionRefresh();
    const invitations = await fetchSidebarRoomCollection("invitations");
    if (
      !isCurrent() ||
      !invitations ||
      requestRevision < latestInvitationsRefreshRef.current
    )
      return;
    latestInvitationsRefreshRef.current = requestRevision;
    setPendingRows(invitations);
  }, []);

  // A workspace or user switch restarts every read, so an in-flight response
  // for the previous workspace is discarded. Mobile sheet remounts the list
  // with stale RSC props; the mount read lets Core replace attention from
  // earlier visits and other tabs.
  const healthy = useAblyConnectionHealthy();
  const scope = paintOnly ? null : `${organizationId ?? ""}:${currentUserId}`;
  // Rooms are only ever named while a read is in flight or waiting out a
  // throttle, so the read these three ask for starts after they have run.
  // `scope` is the trigger: a new one starts with nothing known.
  useEffect(() => {
    staleActiveRef.current = { rooms: new Set(), wholeList: true };
    const onOnline = () => {
      staleActiveRef.current.wholeList = true;
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scope]);
  // `healthy` is the trigger: either flip can have lost an event.
  useEffect(() => {
    staleActiveRef.current.wholeList = true;
  }, [healthy]);
  const requestActive = useChatRefreshScheduler({
    key: scope && `${scope}:active`,
    refresh: refreshActive,
    healthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });
  requestActiveRef.current = requestActive;
  // Archived rooms carry no unread state and arrive with the page, so they
  // skip the mount read; archive and restore events still ask for them.
  const requestArchived = useChatRefreshScheduler({
    key: scope && hasOrganization ? `${scope}:archived` : null,
    refresh: refreshArchived,
    healthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnRecovery: true,
  });
  const requestInvitations = useChatRefreshScheduler({
    key: scope && `${scope}:invitations`,
    refresh: refreshInvitations,
    healthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });
  const requestCollections = useCallback(
    (collections?: readonly ChatRoomCollection[], roomId?: string | null) => {
      const wanted = new Set<ChatRoomCollection>(
        collections ?? ["active", "archived", "invitations"],
      );
      if (wanted.has("active")) {
        if (roomId && roomRowsRef.current.some((row) => row.id === roomId)) {
          staleActiveRef.current.rooms.add(roomId);
        } else {
          staleActiveRef.current.wholeList = true;
        }
        requestActive();
      }
      if (wanted.has("archived")) requestArchived();
      if (wanted.has("invitations")) requestInvitations();
    },
    [requestActive, requestArchived, requestInvitations],
  );

  useEffect(() => {
    if (paintOnly) {
      return;
    }

    return subscribeOrganizationChatRoomRead(setRoomRows);
  }, [paintOnly]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }

    return subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) => {
        latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
        latestArchivedRefreshRef.current = latestAppliedRefreshRef.current;
        setRoomRows((current) =>
          applyRoomReadOverlays(
            current.filter((row) => row.id !== removedRoomId),
          ),
        );
        setArchivedRows((current) =>
          current.filter((row) => row.id !== removedRoomId),
        );
      },
      onRoom: upsertRoomToTop,
      onInvalidated: requestCollections,
    });
  }, [paintOnly, requestCollections, upsertRoomToTop]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    publishMembershipVisibleRooms(
      roomRows,
      organizationId,
      currentUserId,
      rooms,
    );
  }, [currentUserId, organizationId, paintOnly, roomRows, rooms]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    return registerMembershipVisibleRoomsPublisher();
  }, [paintOnly]);

  return {
    roomRows,
    archivedRows,
    pendingRows,
    setArchivedRows,
    setPendingRows,
    upsertRoomToTop,
    replaceRoom,
    replaceAllRooms,
    applyPinnedOrder,
  };
}
