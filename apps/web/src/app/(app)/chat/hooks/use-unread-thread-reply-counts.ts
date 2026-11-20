"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { listUnreadThreadReplyCountsAction } from "@/app/chat/actions";

/** Burst window for re-reads. Short enough to read as immediate. */
const READ_DEBOUNCE_MS = 150;

function waitForBurstWindow(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
  const queryClient = useQueryClient();
  const [lastRead, setLastRead] = useState<{
    roomId: string;
    refreshKey: string;
    replyCounts: ReadonlyMap<string, number>;
  } | null>(null);

  const query = useQuery({
    queryKey: ["chat", "unread-thread-reply-counts", roomId, refreshKey],
    queryFn: async ({ signal }) => {
      if (!roomId) {
        throw new Error("No room selected");
      }
      await waitForBurstWindow(READ_DEBOUNCE_MS, signal);
      const result = await listUnreadThreadReplyCountsAction(roomId);
      if (!result.ok) {
        throw new Error(result.error.message ?? undefined);
      }
      return new Map(
        result.value.map((thread) => [
          thread.parentMessageId,
          thread.unreadReplyCount,
        ]),
      );
    },
    enabled: Boolean(roomId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (
    roomId &&
    query.data !== undefined &&
    (lastRead?.roomId !== roomId ||
      lastRead.refreshKey !== refreshKey ||
      lastRead.replyCounts !== query.data)
  ) {
    setLastRead({
      roomId,
      refreshKey,
      replyCounts: query.data,
    });
  }

  const clear = useCallback(
    (isCleared: (parentMessageId: string) => boolean) => {
      const filterMap = (current: ReadonlyMap<string, number>) => {
        const replyCounts = new Map(
          [...current].filter(([id]) => !isCleared(id)),
        );
        return replyCounts.size === current.size ? current : replyCounts;
      };
      queryClient.setQueryData<ReadonlyMap<string, number>>(
        ["chat", "unread-thread-reply-counts", roomId, refreshKey],
        (current) => (current ? filterMap(current) : current),
      );
      setLastRead((current) => {
        if (!current) {
          return current;
        }
        const replyCounts = filterMap(current.replyCounts);
        return replyCounts === current.replyCounts
          ? current
          : { ...current, replyCounts };
      });
    },
    [queryClient, refreshKey, roomId],
  );

  // An answer belongs to the room it was read for, so switching rooms shows
  // nothing until that room's own read lands.
  return {
    replyCounts:
      query.data ?? (lastRead?.roomId === roomId ? lastRead.replyCounts : null),
    clear,
  };
}
