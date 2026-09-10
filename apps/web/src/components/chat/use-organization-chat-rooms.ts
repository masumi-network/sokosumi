"use client";

import type { ChatRoomCollection } from "@sokosumi/utils";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";

import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import { publishMembershipVisibleRooms } from "./membership-visible-rooms-store";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "./organization-chat-events";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "./room-read-overlay";
import { useChatRefreshScheduler } from "./use-chat-refresh-scheduler";

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
  const latestArchivedRefreshRef = useRef(0);
  const latestInvitationsRefreshRef = useRef(0);
  const [roomRows, setRoomRows] = useState(() => applyRoomReadOverlays(rooms));
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
   *
   * The archived copy goes at the same time: a room is live or archived, never
   * both, so the two collections cannot be updated apart without the room
   * appearing twice.
   */
  const upsertRoomToTop = useCallback((room: ChatRoom) => {
    latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
    latestArchivedRefreshRef.current = latestAppliedRefreshRef.current;
    setRoomRows((current) => {
      const without = current.filter((row) => row.id !== room.id);
      return applyRoomReadOverlays([room, ...without]);
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

  /** Replace the whole live list with a freshly fetched one. */
  const replaceAllRooms = useCallback(
    (rooms: ChatRoom[], requestRevision: number) => {
      if (requestRevision < latestAppliedRefreshRef.current) return;
      latestAppliedRefreshRef.current = requestRevision;
      setRoomRows(reconcileRoomAttention(rooms, requestRevision));
    },
    [],
  );

  /** Each collection recovers on its own; a failed read keeps the last rows. */
  const refreshActive = useCallback(
    async (isCurrent: () => boolean) => {
      const requestRevision = beginRoomAttentionRefresh();
      const page = await fetchSidebarRoomCollection("active");
      if (!isCurrent() || !page) return;
      replaceAllRooms(page.rooms, requestRevision);
    },
    [replaceAllRooms],
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
  const requestActive = useChatRefreshScheduler({
    key: scope && `${scope}:active`,
    refresh: refreshActive,
    healthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });
  const requestArchived = useChatRefreshScheduler({
    key: scope && hasOrganization ? `${scope}:archived` : null,
    refresh: refreshArchived,
    healthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
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
    (collections?: readonly ChatRoomCollection[]) => {
      const wanted = new Set<ChatRoomCollection>(
        collections ?? ["active", "archived", "invitations"],
      );
      if (wanted.has("active")) requestActive();
      if (wanted.has("archived")) requestArchived();
      if (wanted.has("invitations")) requestInvitations();
    },
    [requestActive, requestArchived, requestInvitations],
  );

  useEffect(() => {
    if (paintOnly) {
      return;
    }

    const handleRoomRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ room?: ChatRoom; roomId?: string }>
      ).detail;
      if (!detail?.roomId) {
        return;
      }

      if (detail.room) {
        // Dual-baseline: leftover Participant Thread unread stays on the row.
        rememberRoomRead(detail.room);
      }

      setRoomRows((current) =>
        applyRoomReadOverlays(
          current.map((room) => {
            if (room.id !== detail.roomId) return room;
            const updated = detail.room ?? {
              ...room,
              unreadCount: 0,
              unreadMentionCount: 0,
              markedUnread: false,
            };
            if (!detail.room) rememberRoomRead(updated);
            return updated;
          }),
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, [paintOnly]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }

    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      const removedRoomId = detail?.removedRoomId;
      if (removedRoomId) {
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
        return;
      }

      const room = detail?.room;
      if (room) {
        upsertRoomToTop(room);
        return;
      }

      requestCollections(detail?.collections);
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, [paintOnly, requestCollections, upsertRoomToTop]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    publishMembershipVisibleRooms(roomRows, organizationId, currentUserId);
  }, [currentUserId, organizationId, paintOnly, roomRows]);

  return {
    roomRows,
    archivedRows,
    pendingRows,
    setArchivedRows,
    setPendingRows,
    upsertRoomToTop,
    replaceRoom,
    replaceAllRooms,
  };
}
