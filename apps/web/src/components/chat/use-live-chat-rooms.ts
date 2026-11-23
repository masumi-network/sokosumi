"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { CancelledError, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { fetchSidebarRoomCollection } from "@/components/chat/fetch-sidebar-room-collection";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  hasLiveMembershipVisibleRoomsPublisher,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  useOrganizationChatRoomRead,
  useOrganizationChatRoomsChanged,
} from "@/components/chat/organization-chat-events";
import { keepRoomUnreadState } from "@/components/chat/room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
} from "@/components/chat/room-read-overlay";
import { useChatRefreshScheduler } from "@/components/chat/use-chat-refresh-scheduler";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { useLiveChatRoomsOwnershipSettled } from "@/hooks/effects/use-live-chat-rooms-ownership-settled";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";
import { chatQueryKeys, splitChatQueryKey } from "@/queries/chat";
import { useScopedQuery } from "@/queries/scoped-queries";

/** Poll cadence while the Ably connection is unavailable. */
const LIVE_CHAT_ROOMS_FALLBACK_MS = 15_000;

/** The user and workspace a list of rooms belongs to. */
function roomsScope(
  organizationId: string | null,
  userId: string,
): string | null {
  return userId ? `${organizationId ?? ""}:${userId}` : null;
}

/**
 * The reader's live membership-visible rooms, for chat surfaces that need
 * what is unread without mounting the sidebar list: the Chats tab's unread
 * dot, and the Threads view (SOK-1159).
 *
 * Reads the same React Query entry as the sidebar list
 * (`chatQueryKeys.sidebarRoomCollection(scope, "active")`). While a sidebar
 * list is mounted it already schedules the active collection reads; without
 * one (the phone, away from the Chats list) this hook runs the same read on
 * the same schedule itself.
 *
 * Null until a first read or a session snapshot says what the rooms are, so
 * a reader in no room (an empty list) is not mistaken for one not read yet.
 */
export function useLiveChatRooms(): ChatRoom[] | null {
  return useLiveChatRoomsRead().rooms;
}

/**
 * `useLiveChatRooms`, plus whether this user and workspace's first read
 * failed with no rows held, so a caller can say so while the reader retries.
 */
export function useLiveChatRoomsRead(): {
  rooms: ChatRoom[] | null;
  failed: boolean;
} {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? "";
  const organizationId = session?.session.activeOrganizationId ?? null;
  const scope = roomsScope(organizationId, currentUserId);
  // Read by the async refresh, which keeps one identity across scopes.
  const scopeRef = useLatestRef(scope);
  const latestAppliedRefreshRef = useRef(0);

  const activeKey = chatQueryKeys.sidebarRoomCollection(
    { userId: currentUserId || null, workspaceId: organizationId },
    "active",
  );
  const activeKeyRef = useLatestRef(activeKey);

  // A mounted sidebar list already reads the active collection on the same
  // schedule; share its cache rather than run a second reader (desktop).
  const sidebarOwnsReads = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    hasLiveMembershipVisibleRoomsPublisher,
    () => false,
  );
  // The desktop sidebar registers as the reader from an effect, often in a
  // later streamed commit than this hook's. Reading at once would read the
  // same collection twice, so on desktop this waits a moment for it; on a
  // phone there is no sidebar to wait for.
  const ownershipSettled = useLiveChatRoomsOwnershipSettled();
  const liveSnapshot = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    getLatestMembershipVisibleRoomsSnapshot,
    () => null,
  );

  const hasCachedData =
    scope !== null && queryClient.getQueryData(activeKey) !== undefined;
  const activeQuery = useScopedQuery({
    ...splitChatQueryKey(activeKey),
    queryFn: async ({ client, queryKey, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      // The ref moves in the layout phase, before the scheduler's passive
      // cleanup makes `isCurrent` false, so an answer can land between them.
      const requestScope = scopeRef.current;
      const page = await fetchSidebarRoomCollection("active");
      if (signal.aborted || scopeRef.current !== requestScope) {
        throw new CancelledError({ revert: true });
      }
      if (!page) {
        throw new Error("Failed to read active chat rooms");
      }
      const current = client.getQueryData<ChatRoom[]>(queryKey);
      if (current && requestRevision < latestAppliedRefreshRef.current) {
        return current;
      }
      latestAppliedRefreshRef.current = requestRevision;
      return reconcileRoomAttention(page.rooms, requestRevision);
    },
    // Enable only once data is in the cache so `useScopedQuery` never fires
    // an unscheduled mount fetch ahead of the desktop handoff wait or throttle
    // clock; `useChatRefreshScheduler` owns all read timing.
    enabled: Boolean(
      scope && ownershipSettled && !sidebarOwnsReads && hasCachedData,
    ),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  const activeQueryRef = useLatestRef(activeQuery);

  // Same GET read and scheduling rules as the sidebar's active collection
  // (SOK-986): timer reads pause while hidden or unfocused with one read on
  // return, invalidations read at once, and a slow recovery cadence while
  // Ably is connected.
  const refreshRooms = useCallback(
    async (isCurrent: () => boolean) => {
      const requestScope = scopeRef.current;
      const key = activeKeyRef.current;
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: key, exact: true });
      if (query && !query.isDisabled()) {
        await queryClient.refetchQueries({ queryKey: key, exact: true });
      } else {
        await activeQueryRef.current.refetch();
      }
      if (!isCurrent() || scopeRef.current !== requestScope) {
        void queryClient.cancelQueries({ queryKey: key, exact: true });
      }
    },
    [activeKeyRef, activeQueryRef, queryClient, scopeRef],
  );
  const requestRefresh = useChatRefreshScheduler({
    key:
      scope && ownershipSettled && !sidebarOwnsReads ? `${scope}:unread` : null,
    refresh: refreshRooms,
    healthy: useAblyConnectionHealthy(),
    fallbackIntervalMs: LIVE_CHAT_ROOMS_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  const updateCachedRooms = useCallback(
    (apply: (rooms: ChatRoom[]) => ChatRoom[]) => {
      queryClient.setQueryData<ChatRoom[]>(activeKeyRef.current, (current) =>
        current === undefined ? current : apply(current),
      );
    },
    [activeKeyRef, queryClient],
  );

  useOrganizationChatRoomRead(updateCachedRooms, undefined, !sidebarOwnsReads);

  useOrganizationChatRoomsChanged(
    {
      onRemoved: () => {
        latestAppliedRefreshRef.current = beginRoomAttentionRefresh();
        void queryClient.cancelQueries({
          queryKey: activeKeyRef.current,
          exact: true,
        });
        void queryClient.invalidateQueries({
          queryKey: activeKeyRef.current,
          exact: true,
          refetchType: "none",
        });
        requestRefresh();
      },
      onRoom: (room) =>
        // The answers that land here do not count what is unread, so the
        // room keeps what the title already counted for it.
        // One room is not the list; the first read still decides it.
        updateCachedRooms((current) => {
          const held = current.find((row) => row.id === room.id);
          const without = current.filter((row) => row.id !== room.id);
          return applyRoomReadOverlays([
            keepRoomUnreadState(held, room),
            ...without,
          ]);
        }),
      onInvalidated: (collections) => {
        // Only the active collection holds what is unread.
        if (!collections || collections.includes("active")) {
          requestRefresh();
        }
      },
    },
    !sidebarOwnsReads,
  );

  const matchingSnapshot =
    scope !== null &&
    liveSnapshot &&
    liveSnapshot.currentUserId === currentUserId &&
    liveSnapshot.organizationId === organizationId
      ? liveSnapshot
      : null;

  // Rows read for another user or workspace never show, even before this
  // scope's own read lands.
  const rooms =
    scope === null
      ? null
      : (activeQuery.data ??
        (matchingSnapshot
          ? applyRoomReadOverlays([...matchingSnapshot.rooms])
          : null));

  return {
    rooms,
    failed:
      rooms === null &&
      scope !== null &&
      activeQuery.isError &&
      !activeQuery.isFetching,
  };
}
