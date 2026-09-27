"use client";

import { useCallback, useEffect, useState } from "react";

import { listUnreadThreadReplyCountsAction } from "@/app/chat/actions";

/** Burst window for re-reads. Short enough to read as immediate. */
const READ_DEBOUNCE_MS = 150;

/**
 * Unread replies per Thread in the visible room, keyed by parent message id.
 *
 * One read feeds two surfaces: the header threads trigger shows the map's
 * size, and each loaded parent's reply bar takes its count from it. A parent
 * absent from the map has no unread replies. Gating stays in Core, because a
 * realtime reply is broadcast to the whole room and cannot say whether it
 * counts for this reader (ADR-0013, ADR-0030).
 *
 * `clear` drops Threads the reader just Looked at or marked read, so both
 * surfaces settle at once instead of after the re-read. The caller bumps
 * `refreshKey` alongside it, which also discards any read already in flight.
 *
 * `refreshKey` is any string the caller changes when thread read state moves:
 * a reply arriving over realtime, a thread Look, Mark all, or the panel
 * closing. A failed read keeps the last answer rather than blanking the
 * chrome, because this is a decoration and an error banner would outweigh it.
 *
 * Reads are coalesced behind a short delay. A busy room can fire the key
 * several times in a second (a burst of replies, a close that follows a Look),
 * and only the last of those answers is wanted.
 *
 * `replyCounts` is null until the room's own first read lands.
 */
export function useUnreadThreadReplyCounts(
  roomId: string | null,
  refreshKey: string,
): {
  replyCounts: ReadonlyMap<string, number> | null;
  clear: (isCleared: (parentMessageId: string) => boolean) => void;
} {
  const [lastRead, setLastRead] = useState<{
    roomId: string;
    replyCounts: ReadonlyMap<string, number>;
  } | null>(null);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    let active = true;
    const timeoutId = window.setTimeout(() => {
      void listUnreadThreadReplyCountsAction(roomId)
        .then((result) => {
          if (active && result.ok) {
            setLastRead({
              roomId,
              replyCounts: new Map(
                result.value.map((thread) => [
                  thread.parentMessageId,
                  thread.unreadReplyCount,
                ]),
              ),
            });
          }
        })
        // A server action rejects instead of answering with a result when the
        // POST comes back as something other than RSC. That is the same
        // outcome as a failed read, so keep the last answer.
        .catch(() => {});
    }, READ_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [roomId, refreshKey]);

  const clear = useCallback(
    (isCleared: (parentMessageId: string) => boolean) => {
      setLastRead((current) => {
        if (!current) {
          return current;
        }
        const replyCounts = new Map(
          [...current.replyCounts].filter(([id]) => !isCleared(id)),
        );
        return replyCounts.size === current.replyCounts.size
          ? current
          : { ...current, replyCounts };
      });
    },
    [],
  );

  // An answer belongs to the room it was read for, so switching rooms shows
  // nothing until that room's own read lands.
  return {
    replyCounts: lastRead?.roomId === roomId ? lastRead.replyCounts : null,
    clear,
  };
}
