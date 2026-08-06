"use client";

import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useMemo, useRef } from "react";

import {
  type ChatRoomMessageEventData,
  chatRoomMessageEventDataSchema,
  makeChatRoomChannelName,
} from "@/lib/ably";

import { personalizeChatRoomMessageEvent } from "./personalize-chat-room-message-event";

const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

interface UseChatRoomRealtimeOptions {
  /** Membership room ids to attach (all rooms for sidebar/live parity). */
  roomIds: readonly string[];
  currentUserId: string;
  onMessage?: (event: ChatRoomMessageEventData) => void;
  onError?: (error: Error) => void;
}

/**
 * Subscribe to room-scoped chat_room_message channels (SOK-741).
 * Re-authorizes Ably when the membership set changes so token caps stay fresh.
 */
export function useChatRoomRealtime({
  roomIds,
  currentUserId,
  onMessage,
  onError,
}: UseChatRoomRealtimeOptions) {
  const ably = useAbly();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const roomIdsKey = useMemo(
    () => [...new Set(roomIds)].sort().join("\0"),
    [roomIds],
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const ids = roomIdsKey.length > 0 ? roomIdsKey.split("\0") : [];
    let cancelled = false;
    const channels: Ably.RealtimeChannel[] = [];

    const handleMessage = (message: Ably.Message) => {
      const parsedResult = chatRoomMessageEventDataSchema.safeParse(
        message.data,
      );
      if (!parsedResult.success) {
        const error = new Error(
          `Failed to parse ChatRoomMessageEventData from message: ${parsedResult.error.message}`,
        );
        console.error(error, message, parsedResult.error);
        onErrorRef.current?.(error);
        return;
      }

      onMessageRef.current?.(
        personalizeChatRoomMessageEvent(parsedResult.data, currentUserId),
      );
    };

    function detachAll() {
      for (const channel of channels) {
        channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
      }
      channels.length = 0;
    }

    async function attachRooms() {
      // Refresh capabilities after join/leave (roomIds change).
      try {
        await ably.auth.authorize();
      } catch (error) {
        if (cancelled) {
          return;
        }
        const err =
          error instanceof Error
            ? error
            : new Error("Failed to re-authorize Ably for chat rooms");
        console.error(err, error);
        onErrorRef.current?.(err);
      }

      if (cancelled) {
        return;
      }

      for (const roomId of ids) {
        if (cancelled) {
          detachAll();
          return;
        }
        const channel = ably.channels.get(makeChatRoomChannelName(roomId));
        channel.subscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        channels.push(channel);
      }

      // Cleanup ran while the loop was finishing — drop any late attaches.
      if (cancelled) {
        detachAll();
      }
    }

    void attachRooms();

    return () => {
      cancelled = true;
      detachAll();
    };
  }, [ably, currentUserId, roomIdsKey]);
}
