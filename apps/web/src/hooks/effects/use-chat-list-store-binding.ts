"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { useEffect, useLayoutEffect } from "react";

import type { ChatListStore } from "@/components/chat/chat-list-store";

export interface UseChatListStoreBindingOptions {
  store: ChatListStore;
  rooms: ChatRoom[];
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
  archivedRooms,
  pendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
  healthy,
}: UseChatListStoreBindingOptions): void {
  useLayoutEffect(() => {
    store.syncProps({
      rooms,
      archivedRooms,
      pendingInvitations,
    });
  }, [store, rooms, archivedRooms, pendingInvitations]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    store.attach({ organizationId, currentUserId });
    return () => {
      store.detach();
    };
  }, [store, paintOnly, organizationId, currentUserId]);

  useEffect(() => {
    store.setHealth(healthy);
  }, [store, healthy]);
}
