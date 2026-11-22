"use client";

import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { useEffect } from "react";

interface ReopenActiveStreamThreadParams {
  isCoworkerStreamRoom: boolean;
  selectedRoom: ChatRoom | null;
  activeStreamParentMessageId: string | null;
  threadParentMessageId: string | undefined;
  topLevelRoomMessages: readonly ChatRoomMessage[];
  loadThreadMessages: (parentMessage: ChatRoomMessage) => unknown;
}

/**
 * Re-opens the thread panel in `RoomsClient` when a coworker thread stream is
 * active or resumed so overlays stay visible after remount or if the panel was
 * closed mid-stream.
 */
export function useRoomsClientReopenActiveStreamThread({
  isCoworkerStreamRoom,
  selectedRoom,
  activeStreamParentMessageId,
  threadParentMessageId,
  topLevelRoomMessages,
  loadThreadMessages,
}: ReopenActiveStreamThreadParams): void {
  useEffect(() => {
    if (
      !isCoworkerStreamRoom ||
      !selectedRoom ||
      !activeStreamParentMessageId
    ) {
      return;
    }
    if (threadParentMessageId === activeStreamParentMessageId) {
      return;
    }
    const parent =
      topLevelRoomMessages.find(
        (message) => message.id === activeStreamParentMessageId,
      ) ?? null;
    if (!parent) {
      return;
    }
    loadThreadMessages(parent);
  }, [
    isCoworkerStreamRoom,
    selectedRoom,
    activeStreamParentMessageId,
    threadParentMessageId,
    topLevelRoomMessages,
  ]);
}
