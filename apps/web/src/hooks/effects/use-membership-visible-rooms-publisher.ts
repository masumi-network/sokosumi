"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useEffect } from "react";
import {
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
} from "@/components/chat/membership-visible-rooms-store";

export interface UseMembershipVisibleRoomsPublisherOptions {
  rooms: readonly ChatRoom[];
  organizationId: string | null;
  currentUserId: string;
  sourceRooms: readonly ChatRoom[];
  enabled?: boolean;
}

/**
 * Publishes the sidebar's live membership-visible rooms to the session store
 * and registers the sidebar as an active publisher while mounted.
 */
export function useMembershipVisibleRoomsPublisher({
  rooms,
  organizationId,
  currentUserId,
  sourceRooms,
  enabled = true,
}: UseMembershipVisibleRoomsPublisherOptions): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    publishMembershipVisibleRooms(
      rooms,
      organizationId,
      currentUserId,
      sourceRooms,
    );
  }, [currentUserId, enabled, organizationId, rooms, sourceRooms]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerMembershipVisibleRoomsPublisher();
  }, [enabled]);
}
