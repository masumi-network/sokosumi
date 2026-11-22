"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useEffect } from "react";
import type { RoomReadAttentionSnapshot } from "@/app/chat/utils/room-read-attention";

export interface RoomReadAttentionTriggerOptions {
  room: ChatRoom | null;
  messagesPending: boolean;
  messageLoadFailed: boolean;
  messages: RoomReadAttentionSnapshot["messages"];
  openThreadParentId: string | null;
  threadMessages: RoomReadAttentionSnapshot["threadMessages"];
  isThreadLoading: boolean;
  transcriptAtEnd: boolean;
}

/**
 * Triggers `readCurrentRoom` in `useRoomReadAttention` whenever the visible
 * room, transcript/thread content, loading flags, or live-edge state change.
 */
export function useRoomReadAttentionTrigger(
  options: RoomReadAttentionTriggerOptions,
  readCurrentRoom: () => Promise<void>,
): void {
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
    options.transcriptAtEnd,
    readCurrentRoom,
  ]);
}
