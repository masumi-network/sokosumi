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
import {
  hasNewOrganizationChatRoomsSeed,
  useOrganizationChatRoomsSeedSync,
} from "@/hooks/effects/use-organization-chat-rooms-seed-sync";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";
import { chatQueryKeys, splitChatQueryKey } from "@/queries/chat";
import { useScopedQuery } from "@/queries/scoped-queries";
import { withPinnedOrder } from "./chat-room-activity-sort";
import {
  fetchSidebarRoom,
  fetchSidebarRoomCollection,
} from "./fetch-sidebar-room-collection";
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
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
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

  const sidebarRoomsPrefixRef = useLatestRef(sidebarRoomsPrefix);
  const activeKeyRef = useLatestRef(activeKey);
  const archivedKeyRef = useLatestRef(archivedKey);
  const invitationsKeyRef = useLatestRef(invitationsKey);

  const latestAppliedRefreshRef = useRef(0);
  const latestRoomSwapRef = useRef(0);
  const latestArchivedRefreshRef = useRef(0);
  const latestInvitationsRefreshRef = useRef(0);

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
    ...splitChatQueryKey(activeKey),
    queryFn: async ({ client, queryKey, signal }) => {
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
        if (signal.aborted) {
          throw new Error("Cancelled reading sidebar room");
        }
        const answered = fresh.filter((room) => room !== null);
        if (answered.length < fresh.length) {
          // A read that failed says nothing about the room, and the list
          // would fail the same way. It stays owed, as a failed list read
          // does. A throttle is the one failure with an end, so that waits
          // out the window like any other read.
          staleActiveRef.current.wholeList = true;
          if (chatReadThrottleResumeInMs() > 0) requestActiveRef.current();
          throw new Error("Failed to read sidebar room");
        }
        const singleRooms = answered.filter((room) => room !== "gone");
        if (singleRooms.length === answered.length) {
          const current = client.getQueryData<ChatRoom[]>(queryKey) ?? [];
          if (requestRevision < latestAppliedRefreshRef.current) {
            // A dropped answer leaves its room stale with nothing to say so.
            // The next read of any kind then takes the whole list.
            staleActiveRef.current.wholeList = true;
            return current;
          }
          // So does an answer for a room that left the rows meanwhile.
          const listed = singleRooms.every((room) =>
            current.some((row) => row.id === room.id),
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
          return current.map((row) => {
            const room = freshById.get(row.id);
            // Core loads the workspace logo and website for the list only.
            return room
              ? {
                  ...room,
                  organizationLogo: row.organizationLogo,
                  organizationWebsiteUrl: row.organizationWebsiteUrl,
                }
              : row;
          });
        }
        // A room the reader can no longer open has left the list. The list
        // read starts now, so a change made during the room reads predates it.
        requestRevision = beginRoomAttentionRefresh();
      }
      const wholeListReadAt = Date.now();
      const page = await fetchSidebarRoomCollection("active");
      if (signal.aborted) {
        throw new Error("Cancelled reading active chat rooms");
      }
      if (!page) {
        // Whatever asked for the whole list is still owed it.
        staleActiveRef.current.wholeList = true;
        throw new Error("Failed to read active chat rooms");
      }
      wholeListReadAtRef.current = wholeListReadAt;
      const current = client.getQueryData<ChatRoom[]>(queryKey) ?? [];
      if (requestRevision < latestAppliedRefreshRef.current) {
        staleActiveRef.current.wholeList = true;
        return current;
      }
      if (requestRevision < latestRoomSwapRef.current) {
        staleActiveRef.current.wholeList = true;
      }
      latestAppliedRefreshRef.current = requestRevision;
      return reconcileRoomAttention(page.rooms, requestRevision);
    },
    initialData: () => {
      const snapshot = getLatestMembershipVisibleRoomsSnapshot();
      // Closing the mobile Sheet unmounts this list. Its unchanged RSC seed
      // must not replace a roster already fetched in this session while Core
      // refreshes.
      const remountRooms =
        !paintOnly &&
        snapshot?.organizationId === organizationId &&
        snapshot.currentUserId === currentUserId &&
        snapshot.sourceRooms === rooms
          ? [...snapshot.rooms]
          : rooms;
      return applyRoomReadOverlays(remountRooms);
    },
    enabled: !paintOnly,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const archivedQuery = useScopedQuery({
    ...splitChatQueryKey(archivedKey),
    queryFn: async ({ client, queryKey, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      const page = await fetchSidebarRoomCollection("archived");
      if (signal.aborted) {
        throw new Error("Cancelled reading archived chat rooms");
      }
      if (!page) {
        throw new Error("Failed to read archived chat rooms");
      }
      const current = client.getQueryData<ChatRoom[]>(queryKey);
      if (current && requestRevision < latestArchivedRefreshRef.current) {
        return current;
      }
      latestArchivedRefreshRef.current = requestRevision;
      return page.rooms;
    },
    initialData: () => archivedRooms,
    enabled: !paintOnly && hasOrganization,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const invitationsQuery = useScopedQuery({
    ...splitChatQueryKey(invitationsKey),
    queryFn: async ({ client, queryKey, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      const invitations = await fetchSidebarRoomCollection("invitations");
      if (signal.aborted) {
        throw new Error("Cancelled reading chat room invitations");
      }
      if (!invitations) {
        throw new Error("Failed to read chat room invitations");
      }
      const current = client.getQueryData<ChatRoomInvitation[]>(queryKey);
      if (current && requestRevision < latestInvitationsRefreshRef.current) {
        return current;
      }
      latestInvitationsRefreshRef.current = requestRevision;
      return invitations;
    },
    initialData: () => pendingInvitations,
    enabled: !paintOnly,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const activeSeedPending = hasNewOrganizationChatRoomsSeed(
    queryClient,
    activeKey,
    rooms,
  );
  const archivedSeedPending = hasNewOrganizationChatRoomsSeed(
    queryClient,
    archivedKey,
    archivedRooms,
  );
  const invitationsSeedPending = hasNewOrganizationChatRoomsSeed(
    queryClient,
    invitationsKey,
    pendingInvitations,
  );

  useOrganizationChatRoomsSeedSync({
    queryClient,
    activeKey,
    rooms,
    archivedKey,
    archivedRooms,
    invitationsKey,
    pendingInvitations,
  });

  const roomRows = activeSeedPending
    ? applyRoomReadOverlays(rooms)
    : (activeQuery.data ?? applyRoomReadOverlays(rooms));
  const archivedRows = archivedSeedPending
    ? archivedRooms
    : (archivedQuery.data ?? archivedRooms);
  const pendingRows = invitationsSeedPending
    ? pendingInvitations
    : (invitationsQuery.data ?? pendingInvitations);

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
      latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
      latestArchivedRefreshRef.current = latestAppliedRefreshRef.current;
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
    [setActiveCache, setArchivedRows],
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
      latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
      setActiveCache((current) => withPinnedOrder(current, order));
    },
    [setActiveCache],
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
      if (requestRevision < latestAppliedRefreshRef.current) {
        staleActiveRef.current.wholeList = true;
        return false;
      }
      if (requestRevision < latestRoomSwapRef.current) {
        staleActiveRef.current.wholeList = true;
      }
      latestAppliedRefreshRef.current = requestRevision;
      setActiveCache(reconcileRoomAttention(nextRooms, requestRevision));
      return true;
    },
    [setActiveCache],
  );

  const refreshActive = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: activeKeyRef.current,
      exact: true,
    });
  }, [activeKeyRef, queryClient]);

  const refreshArchived = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: archivedKeyRef.current,
      exact: true,
    });
  }, [archivedKeyRef, queryClient]);

  const refreshInvitations = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: invitationsKeyRef.current,
      exact: true,
    });
  }, [invitationsKeyRef, queryClient]);

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
        requestActive();
      }
      if (wanted.has("archived")) requestArchived();
      if (wanted.has("invitations")) requestInvitations();
    },
    [requestActive, requestArchived, requestInvitations, roomRowsRef],
  );

  useOrganizationChatRoomRead(setActiveCache, undefined, !paintOnly);

  useOrganizationChatRoomsChanged(
    {
      onRemoved: () => {
        latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
        latestArchivedRefreshRef.current = latestAppliedRefreshRef.current;
        staleActiveRef.current.wholeList = true;
        void queryClient.cancelQueries({
          queryKey: sidebarRoomsPrefixRef.current,
        });
        void queryClient.invalidateQueries({
          queryKey: sidebarRoomsPrefixRef.current,
          refetchType: "none",
        });
        requestActive();
        if (hasOrganization) {
          requestArchived();
        }
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
