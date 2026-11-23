"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "@/components/chat/organization-chat-events";
import { beginRoomAttentionRefresh } from "@/components/chat/room-read-overlay";
import { chatQueryKeys } from "@/queries/chat";

/** At most one read per window, so a busy room costs less than its messages. */
const OTHER_WORKSPACE_READ_WINDOW_MS = 2_000;

/** Revision when each room was last revoked, so an older read cannot restore it. */
const revokedAtRevision = new Map<string, number>();

/** True when `roomId` was revoked after a read started at `requestRevision`. */
export function wasOtherWorkspaceRoomRevokedSince(
  roomId: string,
  requestRevision: number,
): boolean {
  return (revokedAtRevision.get(roomId) ?? 0) > requestRevision;
}

/** A room action's answer does not load the Organization the row shows. */
export function withWorkspaceOf(
  current: ChatRoom,
  updated: ChatRoom,
): ChatRoom {
  return {
    ...updated,
    organizationName: current.organizationName,
    organizationLogo: current.organizationLogo,
    organizationWebsiteUrl: current.organizationWebsiteUrl,
  };
}

/**
 * Subscribes `OtherWorkspaceRoomsLive` to organization chat room removal,
 * read, and throttled active-collection invalidation events while mounted.
 */
export function useOtherWorkspaceRoomsLiveSync(
  queryClient: QueryClient,
  requestRead: () => void,
): void {
  useEffect(() => {
    let timer: number | undefined;
    let lastReadAt = 0;

    function read() {
      timer = undefined;
      lastReadAt = Date.now();
      requestRead();
    }

    function updateRooms(update: (current: ChatRoom[]) => ChatRoom[]) {
      queryClient.setQueriesData<ChatRoom[]>(
        { queryKey: chatQueryKeys.anyElsewhere() },
        (current) => current && update(current),
      );
    }

    const stopRoomsChanged = subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) => {
        revokedAtRevision.set(removedRoomId, beginRoomAttentionRefresh());
        updateRooms((current) =>
          current.filter((room) => room.id !== removedRoomId),
        );
        void queryClient.invalidateQueries({
          queryKey: chatQueryKeys.anyElsewhere(),
          refetchType: "none",
        });
        requestRead();
      },
      // A room handed over whole is one the reader just joined or edited here,
      // so no `onRoom`.
      onInvalidated: (collections) => {
        // Only the active collection's changes hold what is unread.
        if (collections && !collections.includes("active")) {
          return;
        }
        if (timer !== undefined) return;
        // The first message of a quiet spell reads at once; a burst waits.
        const wait = lastReadAt + OTHER_WORKSPACE_READ_WINDOW_MS - Date.now();
        if (wait <= 0) {
          read();
        } else {
          timer = window.setTimeout(read, wait);
        }
      },
    });
    const stopRoomRead = subscribeOrganizationChatRoomRead(
      updateRooms,
      withWorkspaceOf,
    );
    return () => {
      window.clearTimeout(timer);
      stopRoomsChanged();
      stopRoomRead();
    };
  }, []);
}
