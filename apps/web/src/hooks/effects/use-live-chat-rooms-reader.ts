"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import {
  acquireLiveChatRoomsReader,
  type LiveChatRoomsAnswer,
  type LiveChatRoomsCachedAnswer,
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
    const subscription = acquireLiveChatRoomsReader(scope, {
      healthy: latestHealthyRef.current,
      onAnswer: (answer) => handleAnswer(answer),
    });
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
  }, [healthy]);

  return useCallback(() => {
    subscriptionRef.current?.request();
  }, []);
}
