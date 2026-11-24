"use client";

import { useLayoutEffect } from "react";

import type { RoomsClientProps } from "@/app/chat/components/rooms-client";
import type { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";

/**
 * Registers the room route's props and seeds or updates its retained
 * `RoomTranscriptCache` entry before paint so `PersistentRoomView` paints
 * without a blank frame.
 */
export function useRoomRouteBootstrap(
  cache: RoomTranscriptCache | null,
  props: RoomsClientProps,
  register: ((props: RoomsClientProps) => void) | null,
): void {
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
}
