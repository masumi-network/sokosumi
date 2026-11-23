"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { applyRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { useLatestRef } from "./use-latest-ref";

const syncedSeedsByClient = new WeakMap<QueryClient, Map<string, unknown>>();

function getSyncedSeedMap(queryClient: QueryClient): Map<string, unknown> {
  let map = syncedSeedsByClient.get(queryClient);
  if (!map) {
    map = new Map();
    syncedSeedsByClient.set(queryClient, map);
  }
  return map;
}

/**
 * True when `seed` is a newer server prop reference than the one last synced
 * into `queryKey` on this `QueryClient`. Unchanged remounts (such as reopening
 * the mobile Sheet) return false so already-fetched cache rows stay on screen.
 */
export function hasNewOrganizationChatRoomsSeed(
  queryClient: QueryClient,
  queryKey: QueryKey,
  seed: unknown,
): boolean {
  const map = getSyncedSeedMap(queryClient);
  const keyHash = hashKey(queryKey);
  return map.has(keyHash) && map.get(keyHash) !== seed;
}

function syncCollectionSeed<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  keyHash: string,
  seed: T,
  toCacheData: (value: T) => T,
): void {
  const map = getSyncedSeedMap(queryClient);
  const hadSeed = map.has(keyHash);
  const previousSeed = map.get(keyHash);
  map.set(keyHash, seed);

  if (!hadSeed) {
    if (queryClient.getQueryData(queryKey) === undefined) {
      queryClient.setQueryData(queryKey, toCacheData(seed));
    }
    return;
  }

  if (previousSeed !== seed) {
    queryClient.setQueryData(queryKey, toCacheData(seed));
  }
}

export interface UseOrganizationChatRoomsSeedSyncOptions {
  queryClient: QueryClient;
  activeKey: QueryKey;
  rooms: ChatRoom[];
  archivedKey: QueryKey;
  archivedRooms: ChatRoom[];
  invitationsKey: QueryKey;
  pendingInvitations: ChatRoomInvitation[];
}

/**
 * Synchronizes fresh server-rendered sidebar room collection props into the
 * React Query cache while leaving unchanged remounts on their fetched data.
 */
export function useOrganizationChatRoomsSeedSync({
  queryClient,
  activeKey,
  rooms,
  archivedKey,
  archivedRooms,
  invitationsKey,
  pendingInvitations,
}: UseOrganizationChatRoomsSeedSyncOptions): void {
  const activeKeyHash = hashKey(activeKey);
  const archivedKeyHash = hashKey(archivedKey);
  const invitationsKeyHash = hashKey(invitationsKey);
  const activeKeyRef = useLatestRef(activeKey);
  const archivedKeyRef = useLatestRef(archivedKey);
  const invitationsKeyRef = useLatestRef(invitationsKey);

  useEffect(() => {
    syncCollectionSeed(
      queryClient,
      activeKeyRef.current,
      activeKeyHash,
      rooms,
      applyRoomReadOverlays,
    );
  }, [activeKeyHash, activeKeyRef, queryClient, rooms]);

  useEffect(() => {
    syncCollectionSeed(
      queryClient,
      archivedKeyRef.current,
      archivedKeyHash,
      archivedRooms,
      (value) => value,
    );
  }, [archivedKeyHash, archivedKeyRef, archivedRooms, queryClient]);

  useEffect(() => {
    syncCollectionSeed(
      queryClient,
      invitationsKeyRef.current,
      invitationsKeyHash,
      pendingInvitations,
      (value) => value,
    );
  }, [invitationsKeyHash, invitationsKeyRef, pendingInvitations, queryClient]);
}
