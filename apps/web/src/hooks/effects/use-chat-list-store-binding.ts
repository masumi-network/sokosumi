"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { useEffect, useLayoutEffect } from "react";

import type { ChatListStore } from "@/components/chat/chat-list-store";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";

export interface UseChatListStoreBindingOptions {
  store: ChatListStore;
  rooms: ChatRoom[];
  overlaidRooms?: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
  healthy: boolean;
}

/**
 * Binds a mounted chat list to its per-mount `ChatListStore`:
 * - hands changed RSC collection props to the store before paint,
 * - attaches/detaches schedulers and listeners for the active scope,
 * - forwards Ably connection health changes to the store.
 */
export function useChatListStoreBinding({
  store,
  rooms,
  overlaidRooms,
  archivedRooms,
  pendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
  healthy,
}: UseChatListStoreBindingOptions): void {
  const latestHealthyRef = useLatestRef(healthy);

  useLayoutEffect(() => {
    store.syncProps({
      rooms,
      overlaidRooms,
      archivedRooms,
      pendingInvitations,
    });
  }, [store, rooms, overlaidRooms, archivedRooms, pendingInvitations]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    store.attach({ organizationId, currentUserId }, latestHealthyRef.current);
    return () => {
      store.detach();
    };
  }, [store, paintOnly, organizationId, currentUserId, latestHealthyRef]);

  useEffect(() => {
    store.setHealth(healthy);
  }, [store, healthy]);
}
