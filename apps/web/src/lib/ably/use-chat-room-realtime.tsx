"use client";

import {
  CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
  makeChatRoomChannelName,
  makeUserChatControlChannelName,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useMemo, useRef } from "react";

import {
  type ChatRoomMessageEventData,
  type ChatRoomPinnedMessageEventData,
  chatRoomMessageEventDataSchema,
  chatRoomPinnedMessageEventDataSchema,
} from "@/lib/ably";

import {
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
  type ChatMembershipRevokedEvent,
  chatMembershipRevokedEventSchema,
} from "./chat-membership-revoked-event";
import { chatRoomIdsFromAblyCapability } from "./chat-room-ids-from-ably-capability";
import { personalizeChatRoomMessageEvent } from "./personalize-chat-room-message-event";
import { safeDetachChannel, safeSubscribeChannel } from "./safe-detach-channel";

const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

interface UseChatRoomRealtimeOptions {
  /** Membership room ids to attach (all rooms for sidebar/live parity). */
  roomIds: readonly string[];
  currentUserId: string;
  onMessage?: (event: ChatRoomMessageEventData) => void;
  onPinnedMessage?: (event: ChatRoomPinnedMessageEventData) => void;
  onError?: (error: Error) => void;
  /** After local detach + re-auth queue (SOK-746 membership-visible UI). */
  onMembershipRevoked?: (event: ChatMembershipRevokedEvent) => void;
}

/**
 * Subscribe to room-scoped chat_room_message channels (SOK-741).
 *
 * On membership set change: re-authorize once, then attach/detach only the
 * delta (important for external channels that join/leave often). Authorize
 * failure aborts the sync — never add channels on stale caps.
 *
 * Remote membership revoke (SOK-742): Core publishes
 * `chat_membership_revoked` on `chat_control:user_{id}`; client detaches the
 * room immediately then re-authorizes so token caps drop. Thin backstop
 * (SOK-747): focus and visibility→visible only — no periodic re-auth interval.
 */
export function useChatRoomRealtime({
  roomIds,
  currentUserId,
  onMessage,
  onPinnedMessage,
  onError,
  onMembershipRevoked,
}: UseChatRoomRealtimeOptions) {
  const ably = useAbly();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onPinnedMessageRef = useRef(onPinnedMessage);
  onPinnedMessageRef.current = onPinnedMessage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onMembershipRevokedRef = useRef(onMembershipRevoked);
  onMembershipRevokedRef.current = onMembershipRevoked;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  /** Stable handler so incremental unsub targets the same function reference. */
  const handlePinnedMessageRef = useRef((message: Ably.Message) => {
    const parsed = chatRoomPinnedMessageEventDataSchema.safeParse(message.data);
    if (!parsed.success) {
      console.error(
        "Failed to parse chat_room_pinned_message event",
        message,
        parsed.error,
      );
      return;
    }
    onPinnedMessageRef.current?.(parsed.data);
  });

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
  const roomIdsRef = useRef(roomIds);
  roomIdsRef.current = roomIds;
  /**
   * Rooms detached via control-channel revoke. Kept out of `nextIds` even when
   * capability parsing falls back to stale prop roomIds, until props drop the
   * room (membership-visible list refreshed). Re-add later re-attaches cleanly.
   */
  const locallyRevokedRoomIdsRef = useRef(new Set<string>());

  const roomIdsKey = useMemo(
    () => [...new Set(roomIds)].sort().join("\0"),
    [roomIds],
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const handleMessage = handleMessageRef.current;
    const handlePinnedMessage = handlePinnedMessageRef.current;
    /** Coalesce focus+visibility+revoke so two applies never interleave. */
    let syncInFlight = false;
    let syncQueued = false;
    const locallyRevokedRoomIds = locallyRevokedRoomIdsRef.current;

    function detachRoomLocally(roomId: string) {
      const attached = channelsRef.current;
      const channel = attached.get(roomId);
      if (!channel) {
        return;
      }
      channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
      channel.unsubscribe(
        CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
        handlePinnedMessage,
      );
      safeDetachChannel(channel);
      attached.delete(roomId);
    }

    async function runSyncOnce() {
      const generation = ++syncGenerationRef.current;
      const propIds = new Set(
        [...new Set(roomIdsRef.current)].filter((id) => id.length > 0),
      );

      // Membership dropped from props → clear revoke marker so a later rejoin
      // can re-attach. Keep markers while props still list the room (stale).
      for (const roomId of [...locallyRevokedRoomIds]) {
        if (!propIds.has(roomId)) {
          locallyRevokedRoomIds.delete(roomId);
        }
      }

      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await ably.auth.authorize();
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

      const allowedFromToken = chatRoomIdsFromAblyCapability(
        tokenDetails?.capability,
      );
      // Capability ∩ props when parseable; props alone if capability missing
      // (degraded — same as pre-SOK-742 attach set). Always exclude rooms
      // revoked on this client until membership props catch up.
      const candidateIds =
        allowedFromToken == null
          ? propIds
          : new Set([...propIds].filter((id) => allowedFromToken.has(id)));
      const nextIds = new Set(
        [...candidateIds].filter((id) => !locallyRevokedRoomIds.has(id)),
      );
      // Re-check before mutating channels: a newer request may have queued
      // while authorize was in flight (single-flight drains it next).
      if (generation !== syncGenerationRef.current) {
        return;
      }

      const attached = channelsRef.current;

      for (const [roomId, channel] of [...attached.entries()]) {
        if (nextIds.has(roomId)) {
          continue;
        }
        channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        channel.unsubscribe(
          CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
          handlePinnedMessage,
        );
        safeDetachChannel(channel);
        attached.delete(roomId);
      }

      for (const roomId of nextIds) {
        if (attached.has(roomId)) {
          continue;
        }
        const channel = ably.channels.get(makeChatRoomChannelName(roomId));
        safeSubscribeChannel(
          channel,
          CHAT_ROOM_MESSAGE_EVENT_NAME,
          handleMessage,
        );
        safeSubscribeChannel(
          channel,
          CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
          handlePinnedMessage,
        );
        attached.set(roomId, channel);
      }
    }

    async function syncMembershipChannels() {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        do {
          syncQueued = false;
          await runSyncOnce();
        } while (syncQueued);
      } finally {
        syncInFlight = false;
      }
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
      // Invalidate any in-flight authorize that still holds the old room cap
      // so it cannot re-attach after this detach (before the queued re-auth).
      syncGenerationRef.current += 1;
      locallyRevokedRoomIds.add(parsed.data.roomId);
      detachRoomLocally(parsed.data.roomId);
      void syncMembershipChannels();
      onMembershipRevokedRef.current?.(parsed.data);
    }

    void syncMembershipChannels();

    const controlChannel = ably.channels.get(
      makeUserChatControlChannelName(currentUserId),
    );
    safeSubscribeChannel(
      controlChannel,
      CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
      handleMembershipRevoked,
    );

    const onFocus = () => {
      void syncMembershipChannels();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncMembershipChannels();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      syncGenerationRef.current += 1;
      syncQueued = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controlChannel.unsubscribe(
        CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
        handleMembershipRevoked,
      );
      safeDetachChannel(controlChannel);
    };
  }, [ably, currentUserId, roomIdsKey]);

  // Tear down every channel when the Ably client or user identity changes, or
  // on unmount. Membership deltas are handled above without full re-sub.
  useEffect(() => {
    return () => {
      syncGenerationRef.current += 1;
      const handleMessage = handleMessageRef.current;
      const handlePinnedMessage = handlePinnedMessageRef.current;
      const attached = channelsRef.current;
      for (const channel of attached.values()) {
        channel.unsubscribe(CHAT_ROOM_MESSAGE_EVENT_NAME, handleMessage);
        channel.unsubscribe(
          CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
          handlePinnedMessage,
        );
        safeDetachChannel(channel);
      }
      attached.clear();
    };
  }, [ably, currentUserId]);
}
