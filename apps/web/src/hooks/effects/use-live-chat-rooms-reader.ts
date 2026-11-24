"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import {
  acquireLiveChatRoomsReader,
  type LiveChatRoomsAnswer,
  type LiveChatRoomsCachedAnswer,
  type LiveChatRoomsHealthHistory,
  type LiveChatRoomsReaderSubscription,
} from "@/components/chat/live-chat-rooms-reader";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";

export interface UseLiveChatRoomsReaderOptions {
  /** Active scope to read; null detaches this surface from the shared reader. */
  scope: string | null;
  healthy: boolean;
  onAnswer: (answer: LiveChatRoomsAnswer) => void;
  onSeed: (answer: LiveChatRoomsCachedAnswer) => void;
}

/**
 * Attaches a `useLiveChatRoomsRead` surface to the shared live-rooms reader
 * for `scope`, forwards Ably health changes, and returns a stable `request`
 * callback for invalidation events.
 */
export function useLiveChatRoomsReader({
  scope,
  healthy,
  onAnswer,
  onSeed,
}: UseLiveChatRoomsReaderOptions): () => void {
  const latestHealthyRef = useLatestRef(healthy);
  const subscriptionRef = useRef<LiveChatRoomsReaderSubscription | null>(null);
  // Kept for the mounted hook's lifetime (survives Activity hide/reveal and
  // scope switches, resets on true unmount), matching main's scheduler ref.
  const healthHistoryRef = useRef<LiveChatRoomsHealthHistory>({
    hadHealthy: healthy,
    wasHealthy: healthy,
  });
  const handleAnswer = useEffectEvent((answer: LiveChatRoomsAnswer) => {
    onAnswer(answer);
  });
  const handleSeed = useEffectEvent((answer: LiveChatRoomsCachedAnswer) => {
    onSeed(answer);
  });

  useEffect(() => {
    if (!scope) {
      return;
    }
    const nextHealthy = latestHealthyRef.current;
    const subscription = acquireLiveChatRoomsReader(scope, {
      healthy: nextHealthy,
      getHealthHistory: () => healthHistoryRef.current,
      onAnswer: (answer) => handleAnswer(answer),
    });
    healthHistoryRef.current = {
      hadHealthy: healthHistoryRef.current.hadHealthy || nextHealthy,
      wasHealthy: nextHealthy,
    };
    subscriptionRef.current = subscription;
    if (subscription.lastAnswer) {
      handleSeed(subscription.lastAnswer);
    }
    return () => {
      if (subscriptionRef.current === subscription) {
        subscriptionRef.current = null;
      }
      subscription.release();
    };
  }, [scope, latestHealthyRef]);

  useEffect(() => {
    subscriptionRef.current?.setHealth(healthy);
    healthHistoryRef.current = {
      hadHealthy: healthHistoryRef.current.hadHealthy || healthy,
      wasHealthy: healthy,
    };
  }, [healthy]);

  return useCallback(() => {
    subscriptionRef.current?.request();
  }, []);
}
