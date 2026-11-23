"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import {
  CancelledError,
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { fetchSidebarRoomCollection } from "@/components/chat/fetch-sidebar-room-collection";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
} from "@/components/chat/room-read-overlay";
import {
  type ChatQueryScope,
  type ChatQueryScopeInput,
  chatQueryKeys,
  splitChatQueryKey,
} from "@/queries/chat";
import type { UseScopedQueryOptions } from "@/queries/scoped-queries";

interface SidebarRoomsRevisionState {
  revisionByHash: Map<string, number>;
  droppedByHash: Set<string>;
}

const revisionStateByClient = new WeakMap<
  QueryClient,
  SidebarRoomsRevisionState
>();

function getRevisionState(client: QueryClient): SidebarRoomsRevisionState {
  let state = revisionStateByClient.get(client);
  if (!state) {
    state = {
      revisionByHash: new Map(),
      droppedByHash: new Set(),
    };
    revisionStateByClient.set(client, state);
  }
  return state;
}

/**
 * Single revision authority shared across every observer of a sidebar
 * collection key (sidebar list, mobile unread indicator, search, and pin-order
 * / local room writes).
 */
export function getSidebarRoomsRevision(
  client: QueryClient,
  queryKey: QueryKey,
): number {
  return getRevisionState(client).revisionByHash.get(hashKey(queryKey)) ?? 0;
}

export function noteSidebarRoomsRevision(
  client: QueryClient,
  queryKey: QueryKey,
  revision: number,
): void {
  const state = getRevisionState(client);
  const keyHash = hashKey(queryKey);
  const current = state.revisionByHash.get(keyHash) ?? 0;
  if (revision > current) {
    state.revisionByHash.set(keyHash, revision);
  }
}

export function wasSidebarRoomsReadDropped(
  client: QueryClient,
  queryKey: QueryKey,
): boolean {
  return getRevisionState(client).droppedByHash.has(hashKey(queryKey));
}

function recordReadOutcome(
  client: QueryClient,
  queryKey: QueryKey,
  dropped: boolean,
): void {
  const { droppedByHash } = getRevisionState(client);
  const keyHash = hashKey(queryKey);
  if (dropped) {
    droppedByHash.add(keyHash);
  } else {
    droppedByHash.delete(keyHash);
  }
}

type SidebarRoomQueryKey = ["chat", "sidebar-rooms", string];

/**
 * One query-options definition for the membership-visible active rooms list,
 * shared by the sidebar list, the mobile unread indicator, and Go-To Search.
 */
export function sidebarActiveRoomsQueryOptions(
  scope: ChatQueryScopeInput,
): UseScopedQueryOptions<
  ChatRoom[],
  Error,
  ChatRoom[],
  ChatQueryScope,
  SidebarRoomQueryKey
> {
  const fullKey = chatQueryKeys.sidebarRoomCollection(scope, "active");
  const { scope: normalizedScope, queryKey } = splitChatQueryKey(fullKey);
  return {
    scope: normalizedScope,
    queryKey: [...queryKey],
    queryFn: async ({ client, queryKey: key, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      const page = await fetchSidebarRoomCollection("active", normalizedScope);
      if (signal.aborted) {
        throw new CancelledError({ revert: true });
      }
      if (!page) {
        throw new Error("Failed to read active chat rooms");
      }
      const current = client.getQueryData<ChatRoom[]>(key);
      if (current && requestRevision < getSidebarRoomsRevision(client, key)) {
        recordReadOutcome(client, key, true);
        return current;
      }
      recordReadOutcome(client, key, false);
      noteSidebarRoomsRevision(client, key, requestRevision);
      return reconcileRoomAttention(page.rooms, requestRevision);
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  };
}

export function sidebarArchivedRoomsQueryOptions(
  scope: ChatQueryScopeInput,
): UseScopedQueryOptions<
  ChatRoom[],
  Error,
  ChatRoom[],
  ChatQueryScope,
  SidebarRoomQueryKey
> {
  const fullKey = chatQueryKeys.sidebarRoomCollection(scope, "archived");
  const { scope: normalizedScope, queryKey } = splitChatQueryKey(fullKey);
  return {
    scope: normalizedScope,
    queryKey: [...queryKey],
    queryFn: async ({ client, queryKey: key, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      const page = await fetchSidebarRoomCollection(
        "archived",
        normalizedScope,
      );
      if (signal.aborted) {
        throw new CancelledError({ revert: true });
      }
      if (!page) {
        throw new Error("Failed to read archived chat rooms");
      }
      const current = client.getQueryData<ChatRoom[]>(key);
      if (current && requestRevision < getSidebarRoomsRevision(client, key)) {
        return current;
      }
      noteSidebarRoomsRevision(client, key, requestRevision);
      return page.rooms;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  };
}

export function sidebarInvitationsQueryOptions(
  scope: ChatQueryScopeInput,
): UseScopedQueryOptions<
  ChatRoomInvitation[],
  Error,
  ChatRoomInvitation[],
  ChatQueryScope,
  SidebarRoomQueryKey
> {
  const fullKey = chatQueryKeys.sidebarRoomCollection(scope, "invitations");
  const { scope: normalizedScope, queryKey } = splitChatQueryKey(fullKey);
  return {
    scope: normalizedScope,
    queryKey: [...queryKey],
    queryFn: async ({ client, queryKey: key, signal }) => {
      const requestRevision = beginRoomAttentionRefresh();
      const invitations = await fetchSidebarRoomCollection(
        "invitations",
        normalizedScope,
      );
      if (signal.aborted) {
        throw new CancelledError({ revert: true });
      }
      if (!invitations) {
        throw new Error("Failed to read chat room invitations");
      }
      const current = client.getQueryData<ChatRoomInvitation[]>(key);
      if (current && requestRevision < getSidebarRoomsRevision(client, key)) {
        return current;
      }
      noteSidebarRoomsRevision(client, key, requestRevision);
      return invitations;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  };
}

/**
 * Cancels in-flight reads on the named sidebar keys so older responses cannot
 * commit, then marks those keys stale without triggering an unscheduled fetch.
 */
export function cancelAndInvalidateSidebarCollections(
  client: QueryClient,
  keys: readonly QueryKey[],
  options?: { exact?: boolean },
): void {
  const exact = options?.exact;
  for (const queryKey of keys) {
    void client.cancelQueries({ queryKey, exact });
    void client.invalidateQueries({ queryKey, exact, refetchType: "none" });
  }
}

/**
 * Drive `deletedIds` pattern for a revoked room: cancels in-flight sidebar
 * reads, removes the room from cached active/archived lists at once so it hides
 * even if the next GET is throttled or fails, and invalidates the prefix.
 */
export function revokeSidebarRoom(
  client: QueryClient,
  roomId: string,
  prefix: QueryKey = chatQueryKeys.anySidebarRooms(),
): void {
  const revision = beginRoomAttentionRefresh();
  void client.cancelQueries({ queryKey: prefix });

  for (const query of client.getQueryCache().findAll({ queryKey: prefix })) {
    noteSidebarRoomsRevision(client, query.queryKey, revision);
    const collection = query.queryKey[3];
    if (
      (collection !== "active" && collection !== "archived") ||
      !Array.isArray(query.state.data)
    ) {
      continue;
    }
    const current = query.state.data as ChatRoom[];
    const filtered = current.filter((row) => row.id !== roomId);
    if (filtered.length !== current.length) {
      client.setQueryData<ChatRoom[]>(
        query.queryKey,
        collection === "active" ? applyRoomReadOverlays(filtered) : filtered,
      );
    }
  }

  void client.invalidateQueries({ queryKey: prefix, refetchType: "none" });
}
