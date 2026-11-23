"use client";

import type {
  ChatRoom,
  ChatRoomInvitation,
  StarredChatRoomOrder,
} from "@sokosumi/core-client";
import type { ChatRoomCollection } from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { useMembershipVisibleRoomsPublisher } from "@/hooks/effects/use-membership-visible-rooms-publisher";
import { useOrganizationChatRoomsHealthStale } from "@/hooks/effects/use-organization-chat-rooms-health-stale";
import {
  type OrganizationChatRoomsStaleActive,
  useOrganizationChatRoomsScopeStale,
} from "@/hooks/effects/use-organization-chat-rooms-scope-stale";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";
import { chatQueryKeys } from "@/queries/chat";
import {
  cancelAndInvalidateSidebarCollections,
  getSidebarRoomsRevision,
  noteSidebarRoomsRevision,
  revokeSidebarRoom,
  sidebarActiveRoomsQueryOptions,
  sidebarArchivedRoomsQueryOptions,
  sidebarInvitationsQueryOptions,
  wasSidebarRoomsReadDropped,
} from "@/queries/chat-sidebar-rooms";
import { useScopedQuery } from "@/queries/scoped-queries";
import { withPinnedOrder } from "./chat-room-activity-sort";
import { fetchSidebarRoom } from "./fetch-sidebar-room-collection";
import { getLatestMembershipVisibleRoomsSnapshot } from "./membership-visible-rooms-store";
import {
  useOrganizationChatRoomRead,
  useOrganizationChatRoomsChanged,
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
  /** False while `SidebarChatList`'s deferred archived promise is still pending. */
  archivedRoomsSettled?: boolean;
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
}

function initialActiveRooms(
  rooms: ChatRoom[],
  organizationId: string | null,
  currentUserId: string,
): ChatRoom[] {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  // Closing the mobile Sheet unmounts this list. Its unchanged RSC seed must
  // not replace a roster already fetched in this session while Core refreshes.
  const remountRooms =
    snapshot?.organizationId === organizationId &&
    snapshot.currentUserId === currentUserId &&
    snapshot.sourceRooms === rooms
      ? [...snapshot.rooms]
      : rooms;
  return applyRoomReadOverlays(remountRooms);
}

/**
 * Holds the chat sidebar's three room collections in React Query under
 * `chatQueryKeys`: the prop hand-off from RSC and every path that can change
 * the rows behind the reader's back (the scheduled recovery read, foreground
 * return, room-read, and the rooms-changed control event). Each collection is
 * its own scheduled read (SOK-986): an invalidation naming only `archived`
 * never re-reads the other two, timer reads pause while the tab is hidden or
 * unfocused, and a healthy Ably connection slows recovery to once a minute. An
 * invalidation still reads while away: the live rows feed the tab title's
 * unread count, which is the one signal a reader who is not looking at the tab
 * gets.
 *
 * Rendering and room actions live in the components. Room actions still write
 * the archived and pending collections through the setters this returns; the
 * live rows are the exception, because the read overlay has to be reapplied on
 * every write and that rule stays here. `paintOnly` mounts (SOK-903 instant
 * soft-nav) skip every subscription and never seed the cache, so they paint
 * the props they were given and nothing else.
 *
 * The live rows are published to the membership-visible store on every change.
 * Chat surfaces that render without mounting the sidebar read them back from
 * there, the tab-title unread count among them.
 */
export function useOrganizationChatRooms({
  rooms,
  archivedRooms,
  archivedRoomsSettled = true,
  pendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
}: UseOrganizationChatRoomsOptions) {
  const queryClient = useQueryClient();
  const hasOrganization = Boolean(organizationId);
  const queryScope = {
    userId: currentUserId,
    workspaceId: organizationId,
  };
  const sidebarRoomsPrefix = chatQueryKeys.sidebarRooms(queryScope);
  const activeKey = chatQueryKeys.sidebarRoomCollection(queryScope, "active");
  const archivedKey = chatQueryKeys.sidebarRoomCollection(
    queryScope,
    "archived",
  );
  const invitationsKey = chatQueryKeys.sidebarRoomCollection(
    queryScope,
    "invitations",
  );

  const queryScopeRef = useLatestRef(queryScope);
  const sidebarRoomsPrefixRef = useLatestRef(sidebarRoomsPrefix);
  const activeKeyRef = useLatestRef(activeKey);
  const archivedKeyRef = useLatestRef(archivedKey);
  const invitationsKeyRef = useLatestRef(invitationsKey);

  const latestRoomSwapRef = useRef(0);

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
  const staleActiveRef = useRef<OrganizationChatRoomsStaleActive>({
    rooms: new Set<string>(),
    wholeList: false,
  });
  const wholeListReadAtRef = useRef(0);
  const requestActiveRef = useRef(() => {});

  const activeQuery = useScopedQuery({
    ...sidebarActiveRoomsQueryOptions(queryScope),
    initialData: paintOnly
      ? undefined
      : () => initialActiveRooms(rooms, organizationId, currentUserId),
    enabled: !paintOnly,
  });

  const archivedReady =
    archivedRoomsSettled || queryClient.getQueryData(archivedKey) !== undefined;
  const archivedQuery = useScopedQuery({
    ...sidebarArchivedRoomsQueryOptions(queryScope),
    initialData:
      !paintOnly && archivedRoomsSettled ? () => archivedRooms : undefined,
    enabled: !paintOnly && hasOrganization && archivedReady,
  });

  const invitationsQuery = useScopedQuery({
    ...sidebarInvitationsQueryOptions(queryScope),
    initialData: paintOnly ? undefined : () => pendingInvitations,
    enabled: !paintOnly,
  });

  const roomRows = activeQuery.data ?? applyRoomReadOverlays(rooms);
  const archivedRows = archivedQuery.data ?? archivedRooms;
  const pendingRows = invitationsQuery.data ?? pendingInvitations;

  const roomRowsRef = useLatestRef(roomRows);
  const archivedRowsRef = useLatestRef(archivedRows);
  const pendingRowsRef = useLatestRef(pendingRows);

  const setActiveCache = useCallback(
    (updater: ChatRoom[] | ((current: ChatRoom[]) => ChatRoom[])) => {
      queryClient.setQueryData<ChatRoom[]>(activeKeyRef.current, (current) => {
        const base = current ?? roomRowsRef.current;
        return typeof updater === "function" ? updater(base) : updater;
      });
    },
    [activeKeyRef, queryClient, roomRowsRef],
  );

  const setArchivedRows = useCallback(
    (updater: ChatRoom[] | ((current: ChatRoom[]) => ChatRoom[])) => {
      queryClient.setQueryData<ChatRoom[]>(
        archivedKeyRef.current,
        (current) => {
          const base = current ?? archivedRowsRef.current;
          return typeof updater === "function" ? updater(base) : updater;
        },
      );
    },
    [archivedKeyRef, archivedRowsRef, queryClient],
  );

  const setPendingRows = useCallback(
    (
      updater:
        | ChatRoomInvitation[]
        | ((current: ChatRoomInvitation[]) => ChatRoomInvitation[]),
    ) => {
      queryClient.setQueryData<ChatRoomInvitation[]>(
        invitationsKeyRef.current,
        (current) => {
          const base = current ?? pendingRowsRef.current;
          return typeof updater === "function" ? updater(base) : updater;
        },
      );
    },
    [invitationsKeyRef, pendingRowsRef, queryClient],
  );

  /**
   * Put a room at the top of the live list, replacing any row already there.
   * What was unread on that row stays: the answers that land here do not
   * count it.
   *
   * The archived copy goes at the same time: a room is live or archived, never
   * both, so the two collections cannot be updated apart without the room
   * appearing twice.
   */
  const upsertRoomToTop = useCallback(
    (room: ChatRoom) => {
      const revision = beginRoomAttentionRefresh();
      noteSidebarRoomsRevision(queryClient, activeKeyRef.current, revision);
      noteSidebarRoomsRevision(queryClient, archivedKeyRef.current, revision);
      setActiveCache((current) => {
        const held = current.find((row) => row.id === room.id);
        const without = current.filter((row) => row.id !== room.id);
        return applyRoomReadOverlays([
          keepRoomUnreadState(held, room),
          ...without,
        ]);
      });
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
    },
    [
      activeKeyRef,
      archivedKeyRef,
      queryClient,
      setActiveCache,
      setArchivedRows,
    ],
  );

  /**
   * Swap one room in the live list for a newer copy of itself.
   *
   * Mark unread retains the new attention for a later remount with stale
   * props. The action caller owns its pending operation and rollback.
   */
  const replaceRoom = useCallback(
    (updated: ChatRoom) => {
      if (updated.markedUnread) {
        rememberRoomRead(updated);
      }
      setActiveCache((current) =>
        applyRoomReadOverlays(
          current.map((room) => (room.id === updated.id ? updated : room)),
        ),
      );
    },
    [setActiveCache],
  );

  /** Write a pinned order's `starredAt` sort keys onto the live list. */
  const applyPinnedOrder = useCallback(
    (order: StarredChatRoomOrder[]) => {
      // A list fetch already in flight predates this order; drop it on arrival.
      noteSidebarRoomsRevision(
        queryClient,
        activeKeyRef.current,
        beginRoomAttentionRefresh(),
      );
      setActiveCache((current) => withPinnedOrder(current, order));
    },
    [activeKeyRef, queryClient, setActiveCache],
  );

  /**
   * Replace the whole live list with a freshly fetched one. False when a
   * newer change to the list overtook the read and it was dropped.
   *
   * Either way the list can now be behind something: a dropped read never
   * landed, and one that started before a one-room read puts that room's
   * older copy back. Both leave the whole list owed.
   */
  const replaceAllRooms = useCallback(
    (nextRooms: ChatRoom[], requestRevision: number): boolean => {
      if (
        requestRevision <
        getSidebarRoomsRevision(queryClient, activeKeyRef.current)
      ) {
        staleActiveRef.current.wholeList = true;
        return false;
      }
      if (requestRevision < latestRoomSwapRef.current) {
        staleActiveRef.current.wholeList = true;
      }
      noteSidebarRoomsRevision(
        queryClient,
        activeKeyRef.current,
        requestRevision,
      );
      setActiveCache(reconcileRoomAttention(nextRooms, requestRevision));
      return true;
    },
    [activeKeyRef, queryClient, setActiveCache],
  );

  const refreshActive = useCallback(
    async (isCurrent: () => boolean) => {
      const key = activeKeyRef.current;
      const scope = queryScopeRef.current;
      const stale = staleActiveRef.current;
      const roomIds = stale.wholeList ? [] : [...stale.rooms];
      staleActiveRef.current = { rooms: new Set(), wholeList: false };
      if (
        roomIds.length > 0 &&
        roomIds.length <= MAX_SINGLE_ROOM_READS &&
        Date.now() - wholeListReadAtRef.current < CHAT_HEALTHY_REFRESH_MS
      ) {
        const requestRevision = beginRoomAttentionRefresh();
        const fresh = await Promise.all(
          roomIds.map((roomId) => fetchSidebarRoom(roomId, scope)),
        );
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
        const singleRooms = answered.filter((room) => room !== "gone");
        if (singleRooms.length === answered.length) {
          if (requestRevision < getSidebarRoomsRevision(queryClient, key)) {
            // A dropped answer leaves its room stale with nothing to say so.
            // The next read of any kind then takes the whole list.
            staleActiveRef.current.wholeList = true;
            return;
          }
          // So does an answer for a room that left the rows meanwhile.
          const currentRows =
            queryClient.getQueryData<ChatRoom[]>(key) ?? roomRowsRef.current;
          const listed = singleRooms.every((room) =>
            currentRows.some((row) => row.id === room.id),
          );
          if (!listed) {
            staleActiveRef.current.wholeList = true;
          }
          latestRoomSwapRef.current = requestRevision;
          const freshById = new Map(
            reconcileRoomAttention(singleRooms, requestRevision).map((room) => [
              room.id,
              room,
            ]),
          );
          setActiveCache((current) =>
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
          return;
        }
      }
      const wholeListReadAt = Date.now();
      try {
        await queryClient.refetchQueries(
          { queryKey: key, exact: true },
          { throwOnError: true },
        );
      } catch {
        // Whatever asked for the whole list is still owed it.
        staleActiveRef.current.wholeList = true;
        return;
      }
      if (!isCurrent()) {
        void queryClient.cancelQueries({ queryKey: key, exact: true });
        return;
      }
      if (wasSidebarRoomsReadDropped(queryClient, key)) {
        staleActiveRef.current.wholeList = true;
        return;
      }
      wholeListReadAtRef.current = wholeListReadAt;
      if (
        getSidebarRoomsRevision(queryClient, key) < latestRoomSwapRef.current
      ) {
        staleActiveRef.current.wholeList = true;
      }
    },
    [activeKeyRef, queryClient, queryScopeRef, roomRowsRef, setActiveCache],
  );

  const refreshArchived = useCallback(
    async (isCurrent: () => boolean) => {
      const key = archivedKeyRef.current;
      await queryClient.refetchQueries({ queryKey: key, exact: true });
      if (!isCurrent()) {
        void queryClient.cancelQueries({ queryKey: key, exact: true });
      }
    },
    [archivedKeyRef, queryClient],
  );

  const refreshInvitations = useCallback(
    async (isCurrent: () => boolean) => {
      const key = invitationsKeyRef.current;
      await queryClient.refetchQueries({ queryKey: key, exact: true });
      if (!isCurrent()) {
        void queryClient.cancelQueries({ queryKey: key, exact: true });
      }
    },
    [invitationsKeyRef, queryClient],
  );

  // A workspace or user switch restarts every read, so an in-flight response
  // for the previous workspace is discarded. Mobile sheet remounts the list
  // with stale RSC props; the mount read lets Core replace attention from
  // earlier visits and other tabs.
  const healthy = useAblyConnectionHealthy();
  const scope = paintOnly ? null : `${organizationId ?? ""}:${currentUserId}`;
  // Rooms are only ever named while a read is in flight or waiting out a
  // throttle, so the read these three ask for starts after they have run.
  useOrganizationChatRoomsScopeStale(staleActiveRef, scope);
  // `healthy` is the trigger: either flip can have lost an event.
  useOrganizationChatRoomsHealthStale(staleActiveRef, healthy);
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
        cancelAndInvalidateSidebarCollections(
          queryClient,
          [activeKeyRef.current],
          { exact: true },
        );
        requestActive();
      }
      if (wanted.has("archived")) {
        cancelAndInvalidateSidebarCollections(
          queryClient,
          [archivedKeyRef.current],
          { exact: true },
        );
        requestArchived();
      }
      if (wanted.has("invitations")) {
        cancelAndInvalidateSidebarCollections(
          queryClient,
          [invitationsKeyRef.current],
          { exact: true },
        );
        requestInvitations();
      }
    },
    [
      activeKeyRef,
      archivedKeyRef,
      invitationsKeyRef,
      queryClient,
      requestActive,
      requestArchived,
      requestInvitations,
      roomRowsRef,
    ],
  );

  useOrganizationChatRoomRead(setActiveCache, undefined, !paintOnly);

  useOrganizationChatRoomsChanged(
    {
      onRemoved: (removedRoomId) => {
        staleActiveRef.current.wholeList = true;
        revokeSidebarRoom(
          queryClient,
          removedRoomId,
          sidebarRoomsPrefixRef.current,
        );
        requestActive();
        if (hasOrganization) {
          requestArchived();
        }
        requestInvitations();
      },
      onRoom: upsertRoomToTop,
      onInvalidated: requestCollections,
    },
    !paintOnly,
  );

  useMembershipVisibleRoomsPublisher({
    rooms: roomRows,
    organizationId,
    currentUserId,
    sourceRooms: rooms,
    enabled: !paintOnly,
  });

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
