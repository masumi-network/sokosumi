"use client";

import { useEffect, useRef } from "react";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/** Initial room history page (matches `loadRoomMessages` result). */
export interface RoomMessagePage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
  failed: boolean;
}

/**
 * Resolves deferred room history into the parent RoomsClient.
 * Parent stays mounted (chrome/composer); only list state updates on settle.
 */
export function RoomMessagesHydrator({
  promise,
  onResolved,
}: {
  promise: Promise<RoomMessagePage>;
  onResolved: (page: RoomMessagePage) => void;
}) {
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  /** Last promise whose resolution was delivered (survives Strict Mode remount). */
  const deliveredPromiseRef = useRef<Promise<RoomMessagePage> | null>(null);

  useEffect(() => {
    let cancelled = false;

    void promise.then((page) => {
      if (cancelled) {
        return;
      }
      if (deliveredPromiseRef.current === promise) {
        return;
      }
      deliveredPromiseRef.current = promise;
      onResolvedRef.current(page);
    });

    return () => {
      cancelled = true;
    };
  }, [promise]);

  return null;
}
