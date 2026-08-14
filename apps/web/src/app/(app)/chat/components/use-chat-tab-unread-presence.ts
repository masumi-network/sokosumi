"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";
import { listOrganizationChatRoomsAction } from "@/components/chat/organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  applyRoomReadResultToOverlay,
} from "@/components/chat/room-read-overlay";
import type { ChatRoom } from "@/lib/clients/generated/core";

const CHAT_TAB_UNREAD_POLL_MS = 15_000;

export function getActiveRoomIdFromPathname(
  pathname: string | null,
): string | null {
  if (!pathname?.startsWith("/chat/rooms/")) {
    return null;
  }

  const roomId = pathname.split("/")[3];
  return roomId || null;
}

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const pathname = usePathname();
  const activeRoomId = getActiveRoomIdFromPathname(pathname);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);

  const showUnreadDot =
    countChatRoomsWithUnreadAttention(rooms, { activeRoomId }) > 0;

  useEffect(() => {
    let cancelled = false;

    const refreshRooms = async () => {
      const result = await listOrganizationChatRoomsAction();
      if (cancelled || !result.ok) {
        return;
      }
      setRooms(applyRoomReadOverlays(result.value.rooms));
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
        applyRoomReadResultToOverlay(detail.room);
      }

      setRooms((current) =>
        applyRoomReadOverlays(
          current.map((room) =>
            room.id === detail.roomId
              ? (detail.room ?? {
                  ...room,
                  unreadCount: 0,
                  unreadThreadReplyCount: 0,
                  unreadMentionCount: 0,
                  markedUnread: false,
                })
              : room,
          ),
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

      void listOrganizationChatRoomsAction().then((result) => {
        if (cancelled || !result.ok) {
          return;
        }
        setRooms(applyRoomReadOverlays(result.value.rooms));
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
