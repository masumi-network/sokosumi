"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getActiveRoomIdFromPathname } from "@/components/chat/active-room-id";
import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import { getLatestMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";
import { listOrganizationChatRoomsAction } from "@/components/chat/organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import type { ChatRoom } from "@/lib/clients/generated/core";

const CHAT_TAB_UNREAD_POLL_MS = 15_000;

function getInitialRoomsFromSessionSnapshot(): ChatRoom[] {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  if (snapshot == null) {
    return [];
  }
  return applyRoomReadOverlays([...snapshot.rooms]);
}

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const pathname = usePathname();
  const latestAppliedRefreshRef = useRef(0);
  const activeRoomId = getActiveRoomIdFromPathname(pathname);
  const [rooms, setRooms] = useState<ChatRoom[]>(
    getInitialRoomsFromSessionSnapshot,
  );

  const showUnreadDot =
    countChatRoomsWithUnreadAttention(rooms, { activeRoomId }) > 0;

  useEffect(() => {
    let cancelled = false;

    const refreshRooms = async () => {
      const requestRevision = beginRoomAttentionRefresh();
      const result = await listOrganizationChatRoomsAction();
      if (
        cancelled ||
        requestRevision < latestAppliedRefreshRef.current ||
        !result.ok
      ) {
        return;
      }
      latestAppliedRefreshRef.current = requestRevision;
      setRooms(reconcileRoomAttention(result.value.rooms, requestRevision));
    };

    void refreshRooms();

    const intervalId = window.setInterval(
      refreshRooms,
      CHAT_TAB_UNREAD_POLL_MS,
    );
    window.addEventListener("focus", refreshRooms);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshRooms);
    };
  }, []);

  useEffect(() => {
    const handleRoomRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ room?: ChatRoom; roomId?: string }>
      ).detail;
      if (!detail?.roomId) {
        return;
      }

      if (detail.room) {
        rememberRoomRead(detail.room);
      }

      setRooms((current) =>
        applyRoomReadOverlays(
          current.map((room) => {
            if (room.id !== detail.roomId) return room;
            const updated = detail.room ?? {
              ...room,
              unreadCount: 0,
              unreadMentionCount: 0,
              markedUnread: false,
            };
            if (!detail.room) rememberRoomRead(updated);
            return updated;
          }),
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      const removedRoomId = detail?.removedRoomId;
      if (removedRoomId) {
        setRooms((current) =>
          applyRoomReadOverlays(
            current.filter((row) => row.id !== removedRoomId),
          ),
        );
        return;
      }

      const room = detail?.room;
      if (room) {
        setRooms((current) => {
          const without = current.filter((row) => row.id !== room.id);
          return applyRoomReadOverlays([room, ...without]);
        });
        return;
      }

      const requestRevision = beginRoomAttentionRefresh();
      void listOrganizationChatRoomsAction().then((result) => {
        if (
          cancelled ||
          requestRevision < latestAppliedRefreshRef.current ||
          !result.ok
        ) {
          return;
        }
        latestAppliedRefreshRef.current = requestRevision;
        setRooms(reconcileRoomAttention(result.value.rooms, requestRevision));
      });
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, []);

  return { showUnreadDot };
}
