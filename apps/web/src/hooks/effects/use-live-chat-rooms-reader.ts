"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  acquireLiveChatRoomsScheduler,
  acquireLiveChatRoomsWindowListeners,
  attachLiveChatRoomsReader,
  type LiveChatRoomsReaderHandle,
  liveChatRoomsScope,
} from "@/components/chat/membership-visible-rooms-store";

export interface UseLiveChatRoomsReaderOptions {
  organizationId: string | null;
  currentUserId: string;
  healthy: boolean;
  sidebarOwnsReads: boolean;
  ownershipSettled: boolean;
  hasMountedRef: RefObject<boolean>;
}

/**
 * Binds a surface's mount (and React Activity visibility) to the shared
 * module-level live-rooms reader while keeping main's passive-effect timing:
 *
 * - Ownership settlement and publisher registration are observed after commit
 *   before the scheduler starts (preventing reads when a sibling publisher
 *   mounts or a keyed publisher remounts in the same commit).
 * - On React Activity hide, only timers, the scheduler, and window listeners
 *   stop so held rows and failure state survive hide/reveal.
 * - On reveal, the scheduler starts before room window listeners re-subscribe,
 *   and health updates follow scheduler start (matching main's hook order).
 */
export function useLiveChatRoomsReader({
  organizationId,
  currentUserId,
  healthy,
  sidebarOwnsReads,
  ownershipSettled,
  hasMountedRef,
}: UseLiveChatRoomsReaderOptions): void {
  const latestRef = useRef({ organizationId, currentUserId, healthy });
  const handleRef = useRef<LiveChatRoomsReaderHandle | null>(null);
  const scope = liveChatRoomsScope(organizationId, currentUserId);
  const schedulerKey =
    scope && ownershipSettled && !sidebarOwnsReads ? `${scope}:unread` : null;

  useLayoutEffect(() => {
    latestRef.current = { organizationId, currentUserId, healthy };
    handleRef.current?.commitRenderState(
      organizationId,
      currentUserId,
      healthy,
    );
  });

  useEffect(() => {
    const isReveal = hasMountedRef.current;
    hasMountedRef.current = true;
    const handle = attachLiveChatRoomsReader({
      ...latestRef.current,
      isReveal,
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.detach();
    };
  }, [hasMountedRef]);

  useEffect(() => {
    handleRef.current?.setScope(organizationId, currentUserId);
  }, [organizationId, currentUserId]);

  useEffect(() => {
    if (!schedulerKey) {
      return;
    }
    return acquireLiveChatRoomsScheduler(schedulerKey);
  }, [schedulerKey]);

  useEffect(() => {
    handleRef.current?.setHealth(healthy);
  }, [healthy]);

  useEffect(() => acquireLiveChatRoomsWindowListeners(), []);
}
