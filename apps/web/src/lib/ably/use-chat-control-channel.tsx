"use client";

import {
  CHAT_ROOMS_CHANGED_EVENT_NAME,
  makeUserChatControlChannelName,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useRef } from "react";

import {
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
  type ChatMembershipRevokedEvent,
  chatMembershipRevokedEventSchema,
} from "./chat-membership-revoked-event";
import {
  type ChatRoomsChangedEvent,
  chatRoomsChangedEventSchema,
} from "./chat-rooms-changed-event";
import { safeSubscribeChannel } from "./safe-detach-channel";
import { useAblyConnectionHealthPublisher } from "./use-ably-connection-health-publisher";

interface UseChatControlChannelOptions {
  currentUserId: string;
  /** `chat_membership_revoked`: drop the room from membership-visible UI (SOK-746). */
  onRevoked: (event: ChatMembershipRevokedEvent) => void;
  /** `chat_rooms_changed`: refetch only the named sidebar collections (SOK-986). */
  onRoomsChanged: (event: ChatRoomsChangedEvent) => void;
}

/**
 * Control-channel only: per-user UI signals that need no room capability.
 * Does not attach room message channels — pair with room list mount so
 * membership-visible rooms drop even when the open-room realtime island is off.
 */
export function useChatControlChannel({
  currentUserId,
  onRevoked,
  onRoomsChanged,
}: UseChatControlChannelOptions): void {
  const ably = useAbly();
  useAblyConnectionHealthPublisher();
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;
  const onRoomsChangedRef = useRef(onRoomsChanged);
  onRoomsChangedRef.current = onRoomsChanged;

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    function handleMembershipRevoked(message: Ably.Message) {
      const parsed = chatMembershipRevokedEventSchema.safeParse(message.data);
      if (!parsed.success) {
        console.error(
          "Failed to parse chat_membership_revoked event",
          message,
          parsed.error,
        );
        return;
      }
      onRevokedRef.current(parsed.data);
    }

    function handleRoomsChanged(message: Ably.Message) {
      const parsed = chatRoomsChangedEventSchema.safeParse(message.data);
      if (!parsed.success) {
        console.error(
          "Failed to parse chat_rooms_changed event",
          message,
          parsed.error,
        );
        return;
      }
      onRoomsChangedRef.current(parsed.data);
    }

    const controlChannel = ably.channels.get(
      makeUserChatControlChannelName(currentUserId),
    );
    safeSubscribeChannel(
      controlChannel,
      CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
      handleMembershipRevoked,
    );
    safeSubscribeChannel(
      controlChannel,
      CHAT_ROOMS_CHANGED_EVENT_NAME,
      handleRoomsChanged,
    );

    return () => {
      controlChannel.unsubscribe(
        CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
        handleMembershipRevoked,
      );
      controlChannel.unsubscribe(
        CHAT_ROOMS_CHANGED_EVENT_NAME,
        handleRoomsChanged,
      );
    };
  }, [ably, currentUserId]);
}
