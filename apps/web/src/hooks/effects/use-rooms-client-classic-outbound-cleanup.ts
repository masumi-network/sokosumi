"use client";

import { useEffect } from "react";

import {
  type ClassicOutboundQueueRefs,
  clearClassicOutboundQueue,
} from "@/app/chat/utils/classic-outbound-queue";

/**
 * Drops classic channel and thread outbound queues in `RoomsClient` on room
 * switch, React `<Activity>` hide, and unmount (ADR-0004: no outbox across
 * navigation).
 */
export function useRoomsClientClassicOutboundCleanup(
  selectedRoomId: string | null,
  classicChannelRefs: ClassicOutboundQueueRefs,
  classicThreadRefs: ClassicOutboundQueueRefs,
): void {
  useEffect(() => {
    clearClassicOutboundQueue(classicChannelRefs);
    clearClassicOutboundQueue(classicThreadRefs);
    return () => {
      clearClassicOutboundQueue(classicChannelRefs);
      clearClassicOutboundQueue(classicThreadRefs);
    };
  }, [selectedRoomId, classicChannelRefs, classicThreadRefs]);
}
