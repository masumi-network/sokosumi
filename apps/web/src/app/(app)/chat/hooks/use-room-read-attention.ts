"use client";

import { useCallback, useEffect, useRef } from "react";

import { markThreadReadAction } from "@/app/chat/actions";
import {
  type RoomReadAttentionSnapshot,
  sameRoomReadAttention,
} from "@/app/chat/utils/room-read-attention";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  beginRoomAttentionChange,
  settleRoomAttentionChange,
} from "@/components/chat/room-read-overlay";
import type { ChatRoom } from "@/lib/clients/generated/core";

interface RoomReadAttentionOptions {
  room: ChatRoom | null;
  messagesPending: boolean;
  messageLoadFailed: boolean;
  messages: RoomReadAttentionSnapshot["messages"];
  openThreadParentId: string | null;
  threadMessages: RoomReadAttentionSnapshot["threadMessages"];
  isThreadLoading: boolean;
  /**
   * Called after a Look reaches Core. Every Look lowers the room's unread
   * thread count, including the automatic one this hook writes when the reader
   * returns to a tab with a thread open, so the header count has to hear about
   * it here rather than at the call sites that ask for a thread.
   */
  onThreadLooked?: () => void;
}

function dispatchRoomRead(roomId: string, room: ChatRoom): void {
  window.dispatchEvent(
    new CustomEvent("organization-chat-room-read", {
      detail: { room, roomId },
    }),
  );
}

/** Owns automatic Room last-read and Thread Look writes for the visible room. */
export function useRoomReadAttention(options: RoomReadAttentionOptions) {
  const snapshotRef = useRef(options);
  snapshotRef.current = options;
  const mountedRef = useRef(true);
  const readMarkerRef = useRef<RoomReadAttentionSnapshot | null>(null);

  const canReadRoom = useCallback((roomId: string) => {
    const current = snapshotRef.current;
    return (
      mountedRef.current &&
      document.visibilityState === "visible" &&
      current.room?.id === roomId &&
      !current.messagesPending &&
      !current.messageLoadFailed
    );
  }, []);

  const readRoom = useCallback(
    async (roomId: string, optimistic: boolean): Promise<boolean> => {
      const current = snapshotRef.current;
      if (!canReadRoom(roomId) || !current.room) {
        return false;
      }
      const previousRoom = applyRoomReadOverlays([current.room])[0];
      const pendingRoom = optimistic
        ? {
            ...previousRoom,
            unreadCount: 0,
            unreadMentionCount: 0,
            markedUnread: false,
          }
        : previousRoom;
      const token = beginRoomAttentionChange(pendingRoom, current.room);
      if (optimistic) {
        dispatchRoomRead(roomId, pendingRoom);
      }
      try {
        const result = await markOrganizationChatRoomReadAction(roomId);
        if (
          !settleRoomAttentionChange(
            roomId,
            token,
            result.ok ? result.value : null,
          )
        ) {
          return result.ok;
        }
        dispatchRoomRead(
          roomId,
          result.ok ? result.value : applyRoomReadOverlays([current.room])[0],
        );
        return result.ok;
      } catch {
        if (settleRoomAttentionChange(roomId, token, null)) {
          dispatchRoomRead(roomId, applyRoomReadOverlays([current.room])[0]);
        }
        return false;
      }
    },
    [canReadRoom],
  );

  const lookThread = useCallback(
    async (roomId: string, parentMessageId: string): Promise<boolean> => {
      if (!canReadRoom(roomId)) {
        return false;
      }
      try {
        const result = await markThreadReadAction(roomId, parentMessageId);
        if (result.ok) {
          snapshotRef.current.onThreadLooked?.();
        }
        return result.ok;
      } catch {
        return false;
      }
    },
    [canReadRoom],
  );

  const markThreadRead = useCallback(
    async (roomId: string, parentMessageId: string): Promise<boolean> => {
      const looked = await lookThread(roomId, parentMessageId);
      // Loading may complete after a tab hides, closes the panel, or navigates.
      if (
        !canReadRoom(roomId) ||
        snapshotRef.current.openThreadParentId !== parentMessageId
      ) {
        readMarkerRef.current = null;
        return looked;
      }
      if (looked) {
        await readRoom(roomId, false);
      }
      return looked;
    },
    [canReadRoom, lookThread, readRoom],
  );

  const syncRoomAttentionAfterThreadLook = useCallback(
    async (roomId: string): Promise<void> => {
      if (!(await readRoom(roomId, false))) {
        readMarkerRef.current = null;
      }
    },
    [readRoom],
  );

  const readCurrentRoom = useCallback(async () => {
    const current = snapshotRef.current;
    const roomId = current.room?.id;
    if (!roomId || !canReadRoom(roomId) || current.isThreadLoading) {
      return;
    }
    const marker = { roomId, ...current };
    if (sameRoomReadAttention(readMarkerRef.current, marker)) {
      return;
    }
    readMarkerRef.current = marker;

    let looked = true;
    if (current.openThreadParentId) {
      looked = await lookThread(roomId, current.openThreadParentId);
      const latest = snapshotRef.current;
      if (
        readMarkerRef.current !== marker ||
        latest.room?.id !== roomId ||
        !sameRoomReadAttention(marker, { roomId, ...latest })
      ) {
        return;
      }
    }
    const read = await readRoom(roomId, true);
    if ((!read || !looked) && readMarkerRef.current === marker) {
      readMarkerRef.current = null;
    }
  }, [canReadRoom, lookThread, readRoom]);

  useEffect(() => {
    mountedRef.current = true;
    const handleVisible = () => {
      void readCurrentRoom();
    };
    window.addEventListener("focus", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [readCurrentRoom]);

  useEffect(() => {
    void readCurrentRoom();
  }, [
    options.room?.id,
    options.messages,
    options.openThreadParentId,
    options.threadMessages,
    options.messagesPending,
    options.messageLoadFailed,
    options.isThreadLoading,
    readCurrentRoom,
  ]);

  return { markThreadRead, syncRoomAttentionAfterThreadLook };
}
