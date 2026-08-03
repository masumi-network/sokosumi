"use client";

import type * as Ably from "ably";
import { useChannel } from "ably/react";
import { useCallback } from "react";

import {
  type ChatRoomMessageEventData,
  chatRoomMessageEventDataSchema,
  makeUserChatRoomsChannelName,
} from "@/lib/ably";

const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

interface UseChatRoomRealtimeOptions {
  userId: string;
  onMessage?: (event: ChatRoomMessageEventData) => void;
  onError?: (error: Error) => void;
}

export function useChatRoomRealtime({
  userId,
  onMessage,
  onError,
}: UseChatRoomRealtimeOptions) {
  const handleMessage = useCallback(
    (message: Ably.Message) => {
      const parsedResult = chatRoomMessageEventDataSchema.safeParse(
        message.data,
      );
      if (!parsedResult.success) {
        const error = new Error(
          `Failed to parse ChatRoomMessageEventData from message: ${parsedResult.error.message}`,
        );
        console.error(error, message, parsedResult.error);
        onError?.(error);
        return;
      }

      onMessage?.(parsedResult.data);
    },
    [onMessage, onError],
  );

  useChannel(
    makeUserChatRoomsChannelName(userId),
    CHAT_ROOM_MESSAGE_EVENT_NAME,
    handleMessage,
  );
}
