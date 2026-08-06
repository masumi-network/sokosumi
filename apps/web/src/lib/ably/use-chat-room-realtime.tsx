"use client";

import { makeChatRoomChannelName } from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useMemo, useRef } from "react";

import {
  type ChatRoomMessageEventData,
  chatRoomMessageEventDataSchema,
} from "@/lib/ably";

import { chatRoomIdsFromAblyCapability } from "./chat-room-ids-from-ably-capability";
import { personalizeChatRoomMessageEvent } from "./personalize-chat-room-message-event";

const CHAT_ROOM_MESSAGE_EVENT_NAME = "chat_room_message";

/**
 * Re-mint Ably caps while chat realtime is mounted so remote membership
 * removal (admin kick) drops room subscribe rights within seconds-scale
 * without waiting for token TTL or a local roomIds prop change (SOK-742).
 */
export const CHAT_ROOM_CAP_REAUTH_INTERVAL_MS = 15_000;

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
 *
 * While mounted, also re-authorize on a short interval and on focus /
 * visibility so remote kicks revoke room caps promptly (SOK-742). After each
 * successful authorize, attach is gated by token capability ∩ prop roomIds.
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
  const roomIdsRef = useRef(roomIds);
  roomIdsRef.current = roomIds;

  const roomIdsKey = useMemo(
    () => [...new Set(roomIds)].sort().join("\0"),
    [roomIds],
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const handleMessage = handleMessageRef.current;
    /** Coalesce focus+visibility+interval so two applies never interleave. */
    let syncInFlight = false;
    let syncQueued = false;

    async function runSyncOnce() {
      const generation = ++syncGenerationRef.current;
      const propIds = new Set(
        [...new Set(roomIdsRef.current)].filter((id) => id.length > 0),
      );

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
      // (degraded — same as pre-SOK-742 attach set).
      const nextIds =
        allowedFromToken == null
          ? propIds
          : new Set([...propIds].filter((id) => allowedFromToken.has(id)));

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

    void syncMembershipChannels();

    const intervalId = window.setInterval(() => {
      void syncMembershipChannels();
    }, CHAT_ROOM_CAP_REAUTH_INTERVAL_MS);

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
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
