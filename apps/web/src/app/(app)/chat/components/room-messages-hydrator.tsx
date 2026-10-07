"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { useEffect, useRef } from "react";

/** Initial room history page. */
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
        // A rejected history promise must not leave the parent pending.
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
