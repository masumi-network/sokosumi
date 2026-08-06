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
 *
 * On membership set change: re-authorize once, then attach/detach only the
 * delta (important for external channels that join/leave often). Authorize
 * failure aborts the sync — never add channels on stale caps.
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
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  /** Stable handler so incremental unsub targets the same function reference. */
  const handleMessageRef = useRef((message: Ably.Message) => {
    const parsedResult = chatRoomMessageEventDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      const error = new Error(
        `Failed to parse ChatRoomMessageEventData from message: ${parsedResult.error.message}`,
      );
      console.error(error, message, parsedResult.error);
      onErrorRef.current?.(error);
      return;
    }

    onMessageRef.current?.(
      personalizeChatRoomMessageEvent(
        parsedResult.data,
        currentUserIdRef.current,
      ),
    );
  });

  const channelsRef = useRef(new Map<string, Ably.RealtimeChannel>());
  /** Bumps to invalidate in-flight sync when membership/user changes or unmounts. */
  const syncGenerationRef = useRef(0);

  const roomIdsKey = useMemo(
    () => [...new Set(roomIds)].sort().join("\0"),
    [roomIds],
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const generation = ++syncGenerationRef.current;
    const nextIds = new Set(
      roomIdsKey.length > 0 ? roomIdsKey.split("\0") : [],
    );
    const handleMessage = handleMessageRef.current;

    async function syncMembershipChannels() {
      try {
        await ably.auth.authorize();
      } catch (error) {
        if (generation !== syncGenerationRef.current) {
          return;
        }
        const err =
          error instanceof Error
            ? error
            : new Error("Failed to re-authorize Ably for chat rooms");
        console.error(err, error);
        onErrorRef.current?.(err);
        return;
      }

      if (generation !== syncGenerationRef.current) {
        return;
      }

      const attached = channelsRef.current;

      for (const [roomId, channel] of [...attached.entries()]) {
        if (nextIds.has(roomId)) {
          continue;
        }
        channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        void channel.detach();
        attached.delete(roomId);
      }

      for (const roomId of nextIds) {
        if (attached.has(roomId)) {
          continue;
        }
        const channel = ably.channels.get(makeChatRoomChannelName(roomId));
        channel.subscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        attached.set(roomId, channel);
      }
    }

    void syncMembershipChannels();
  }, [ably, currentUserId, roomIdsKey]);

  // Tear down every channel when the Ably client or user identity changes, or
  // on unmount. Membership deltas are handled above without full re-sub.
  useEffect(() => {
    return () => {
      syncGenerationRef.current += 1;
      const handleMessage = handleMessageRef.current;
      const attached = channelsRef.current;
      for (const channel of attached.values()) {
        channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        void channel.detach();
      }
      attached.clear();
    };
  }, [ably, currentUserId]);
}
