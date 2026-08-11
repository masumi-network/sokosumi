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
 * Parent (header + composer) stays mounted; only list state updates.
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
  const deliveredPromiseRef = useRef<Promise<RoomMessagePage> | null>(null);

  useEffect(() => {
    let cancelled = false;

    void promise.then(
      (page) => {
        if (cancelled) {
          return;
        }
        if (deliveredPromiseRef.current === promise) {
          return;
        }
        deliveredPromiseRef.current = promise;
        onResolvedRef.current(page);
      },
      () => {
        // Unexpected reject (loadRoomMessages maps CoreApiRequestError to
        // failed:true; other throws still reject). Never leave parent pending.
        if (cancelled) {
          return;
        }
        if (deliveredPromiseRef.current === promise) {
          return;
        }
        deliveredPromiseRef.current = promise;
        onResolvedRef.current({
          messages: [],
          nextCursor: null,
          failed: true,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [promise]);

  return null;
}
