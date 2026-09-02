"use client";

import { makeUserChatControlChannelName } from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useRef } from "react";

import {
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
  type ChatMembershipRevokedEvent,
  chatMembershipRevokedEventSchema,
} from "./chat-membership-revoked-event";
import { safeSubscribeChannel } from "./safe-detach-channel";

export type { ChatMembershipRevokedEvent };

interface UseChatMembershipRevokedControlOptions {
  currentUserId: string;
  onRevoked: (event: ChatMembershipRevokedEvent) => void;
}

/**
 * Control-channel only: `chat_membership_revoked` for UI (SOK-746).
 * Does not attach room message channels — pair with room list mount so
 * membership-visible rooms drop even when the open-room realtime island is off.
 */
export function useChatMembershipRevokedControl({
  currentUserId,
  onRevoked,
}: UseChatMembershipRevokedControlOptions): void {
  const ably = useAbly();
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;

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

    const controlChannel = ably.channels.get(
      makeUserChatControlChannelName(currentUserId),
    );
    safeSubscribeChannel(
      controlChannel,
      CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
      handleMembershipRevoked,
    );

    return () => {
      controlChannel.unsubscribe(
        CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
        handleMembershipRevoked,
      );
    };
  }, [ably, currentUserId]);
}
