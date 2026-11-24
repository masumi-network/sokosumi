"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useCallback, useSyncExternalStore } from "react";
import {
  getLiveChatRoomsReadSnapshot,
  getServerLiveChatRoomsReadSnapshot,
  subscribeLiveChatRoomsReader,
} from "@/components/chat/membership-visible-rooms-store";
import { useLiveChatRoomsReader } from "@/hooks/effects/use-live-chat-rooms-reader";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";

/**
 * The reader's live membership-visible rooms, for chat surfaces that need
 * what is unread without mounting the sidebar list: the Chats tab's unread
 * dot, and the Threads view (SOK-1159).
 *
 * While a sidebar list is mounted it already reads the active collection, so
 * this mirrors its rows. Without one (the phone, away from the Chats list) it
 * runs the same read on the same schedule itself, and applies the same room
 * read and rooms-changed events the list does.
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
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? "";
  const organizationId = session?.session.activeOrganizationId ?? null;
  const healthy = useAblyConnectionHealthy();

  const getSnapshot = useCallback(
    () => getLiveChatRoomsReadSnapshot(organizationId, currentUserId),
    [organizationId, currentUserId],
  );
  const snapshot = useSyncExternalStore(
    subscribeLiveChatRoomsReader,
    getSnapshot,
    getServerLiveChatRoomsReadSnapshot,
  );
  useLiveChatRoomsReader(organizationId, currentUserId, healthy);

  return snapshot;
}
