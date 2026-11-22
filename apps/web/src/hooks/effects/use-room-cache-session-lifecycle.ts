"use client";

import type { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import type { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";

/**
 * Activates `RoomTranscriptCache` for `RoomCacheSession`, subscribes to
 * `chat-session-ended` and `organization-chat-rooms-changed` window events,
 * and clears the cache on unmount or cache swap.
 */
export function useRoomCacheSessionLifecycle(
  cache: RoomTranscriptCache,
  router: Pick<ReturnType<typeof useRouter>, "replace">,
): number {
  const replace = useEffectEvent((href: string) => router.replace(href));
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // Next hides the app shell in an Activity while a flow outside it is
    // open, which runs the cleanup below. A room opened as the shell comes
    // back rendered against the cleared cache and would wait on it forever.
    if (cache.activate()) setGeneration((value) => value + 1);
    const ended = () => {
      cache.clear();
      setGeneration((value) => value + 1);
    };
    const removed = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      if (detail?.joinedRoomId) {
        cache.joined(detail.joinedRoomId);
        setGeneration((value) => value + 1);
      }
      if (detail?.removedRoomId) {
        cache.evict(detail.removedRoomId);
        setGeneration((value) => value + 1);
        if (window.location.pathname === `/chat/rooms/${detail.removedRoomId}`)
          replace("/?notice=room-unavailable");
      }
    };
    window.addEventListener("chat-session-ended", ended);
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, removed);
    return () => {
      window.removeEventListener("chat-session-ended", ended);
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        removed,
      );
      cache.clear();
    };
  }, [cache]);

  return generation;
}
