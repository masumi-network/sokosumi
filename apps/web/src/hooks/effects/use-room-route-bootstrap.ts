"use client";

import { createContext, useContext, useLayoutEffect } from "react";

import type { RoomsClientProps } from "@/app/chat/components/rooms-client";
import type { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";

export const RoomBootstrapContext = createContext<
  ((props: RoomsClientProps) => void) | null
>(null);

/**
 * Registers the room route's props with `PersistentRoomView` (via
 * `RoomBootstrapContext`) and seeds or updates its retained
 * `RoomTranscriptCache` entry before paint. Returns whether a registration
 * provider is mounted above the caller so `RoomRouteBootstrap` can fall back
 * to rendering `RoomsClient` directly when none exists.
 */
export function useRoomRouteBootstrap(
  cache: RoomTranscriptCache | null,
  props: RoomsClientProps,
): boolean {
  const register = useContext(RoomBootstrapContext);
  useLayoutEffect(() => {
    const roomId = props.selectedRoomId;
    if (
      !cache ||
      !roomId ||
      !cache.available(roomId) ||
      !cache.matchesScope(
        props.currentUserId,
        props.activeOrganization?.id ?? null,
      )
    )
      return;
    register?.(props);
    const existing = cache.get(roomId);
    cache.client.setQueryData(
      cache.key(roomId),
      existing
        ? {
            ...existing,
            bootstrap: {
              ...props,
              messages: [],
              loadHistoryOnClient: true,
            },
          }
        : cache.seed(props),
    );
  }, [cache, props, register]);
  return register !== null;
}
