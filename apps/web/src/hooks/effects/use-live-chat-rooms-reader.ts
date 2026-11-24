"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  attachLiveChatRoomsReader,
  type LiveChatRoomsReaderHandle,
} from "@/components/chat/membership-visible-rooms-store";

/**
 * Binds a surface's mount (and React Activity visibility) to the shared
 * module-level live-rooms reader, keeping its workspace scope and Ably health
 * synchronized without restarting the desktop wait or triggering reads on
 * health drops.
 */
export function useLiveChatRoomsReader(
  organizationId: string | null,
  currentUserId: string,
  healthy: boolean,
): void {
  const latestRef = useRef({ organizationId, currentUserId, healthy });
  const handleRef = useRef<LiveChatRoomsReaderHandle | null>(null);

  useLayoutEffect(() => {
    latestRef.current = { organizationId, currentUserId, healthy };
    handleRef.current?.commitScope(organizationId, currentUserId);
  });

  useEffect(() => {
    const handle = attachLiveChatRoomsReader(latestRef.current);
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.detach();
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setScope(organizationId, currentUserId);
  }, [organizationId, currentUserId]);

  useEffect(() => {
    handleRef.current?.setHealth(healthy);
  }, [healthy]);
}
