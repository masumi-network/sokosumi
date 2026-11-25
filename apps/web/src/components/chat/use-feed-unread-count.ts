"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchChatFeed } from "@/components/chat/fetch-chat-feed";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { useShowRoomUnreadCount } from "@/components/chat/use-show-room-unread-count";
import { useTimeout } from "@/hooks/effects/use-timeout";
import { chatQueryKeys } from "@/queries/chat";

/**
 * How long a change in the rooms' unread waits before the Feed count is read
 * again. A busy room changes it with every message and every read; one read
 * after the burst keeps the count right without spending Core's read budget.
 */
export const FEED_COUNT_REFRESH_DELAY_MS = 1000;

/**
 * Orders room changes and count reads across every Feed row on the page. A
 * wall clock can move back and make an older read look newer; this only
 * moves forward.
 */
let feedCountStep = 0;
function nextFeedCountStep() {
  feedCountStep += 1;
  return feedCountStep;
}

/**
 * How many Feed messages the reader has not read, for the sidebar Feed row.
 *
 * Reads one item: Core counts the unread across every page, so the row needs
 * no page of its own. `showCount` is the reader's unread count preference
 * (ADR-0038). With it off the row draws no number, and the count still says
 * whether the label reads as unread.
 *
 * The live rooms carry each room's unread, kept current by reads and new
 * messages. When it changes, the count is read again, so reading a Feed
 * message in its room clears it here.
 */
export function useFeedUnreadCount({
  currentUserId,
  organizationId,
}: {
  currentUserId: string;
  organizationId: string | null;
}): { unreadCount: number; showCount: boolean } {
  const showCount = useShowRoomUnreadCount();
  const queryClient = useQueryClient();
  const countKey = chatQueryKeys.feedUnread({
    userId: currentUserId,
    workspaceId: organizationId,
  });
  // The step of the last change waiting for a read, or null when none
  // waits. A read still running from before this mount may predate the last
  // change the unmounted row saw; the mount read reuses it, so it waits too.
  const [changedAt, setChangedAt] = useState(() =>
    queryClient.isFetching({ queryKey: countKey, exact: true }) > 0
      ? nextFeedCountStep()
      : null,
  );
  const { data } = useQuery({
    queryKey: countKey,
    // `startedAt` says which changes the count already includes.
    queryFn: async () => {
      const startedAt = nextFeedCountStep();
      const { unreadCount } = await fetchChatFeed({ limit: 1 });
      return { unreadCount, startedAt };
    },
    retry: false,
    refetchOnWindowFocus: false,
    // A change seen just before the row unmounted loses its timer; the count
    // it left behind is still fresh for the cache.
    refetchOnMount: "always",
  });

  const roomsUnread =
    useLiveChatRooms()
      ?.map(
        (room) =>
          `${room.id}:${room.unreadCount}:${room.unreadNeedsYouCount ?? 0}:${room.mutedAt != null}`,
      )
      .sort()
      .join(",") ?? null;
  // The rooms' unread last seen. Needs-you is part of it: a signal tagged on a
  // message already unread makes it a Feed message without changing the
  // room's unread, and muting a room drops its messages from the Feed.
  // Sorted, so a room moving to the top of the list is no change. Rooms
  // present at mount are not a change, the query reads with them; rooms that
  // load later are, as a message can land between the two reads, unless they
  // load empty and so hold no message. A change inside the wait needs no wait
  // of its own: the read at its end sees it.
  const [seenRoomsUnread, setSeenRoomsUnread] = useState(roomsUnread);
  // Counts the timer's rounds. Each round re-arms the timer whenever a change
  // still waits after it, also when one lands in the render that cleared it.
  const [timerRound, setTimerRound] = useState(0);
  if (roomsUnread !== null && roomsUnread !== seenRoomsUnread) {
    setSeenRoomsUnread(roomsUnread);
    if (seenRoomsUnread !== null || roomsUnread !== "") {
      setChangedAt(nextFeedCountStep());
    }
  }
  useTimeout(
    () => {
      setTimerRound((round) => round + 1);
      // A running read may have read before the change, and an invalidation
      // can hand back that same read. Wait another round for it to finish,
      // then read again; never cancel it, or steady changes starve the count.
      if (queryClient.isFetching({ queryKey: countKey, exact: true }) > 0) {
        return;
      }
      setChangedAt(null);
      // Another Feed row on the page may have read since the change.
      const last = queryClient.getQueryData<{ startedAt: number }>(countKey);
      if (changedAt !== null && last && last.startedAt > changedAt) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: countKey, exact: true });
    },
    changedAt === null ? null : FEED_COUNT_REFRESH_DELAY_MS,
    timerRound,
  );

  return { unreadCount: data?.unreadCount ?? 0, showCount };
}
