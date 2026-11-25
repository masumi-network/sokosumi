"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchChatFeed } from "@/components/chat/fetch-chat-feed";
import { useShowRoomUnreadCount } from "@/components/chat/use-show-room-unread-count";
import { chatQueryKeys } from "@/queries/chat";

/**
 * How many Feed messages the reader has not read, for the sidebar Feed row.
 *
 * Reads one item: Core counts the unread across every page, so the row needs
 * no page of its own. `showCount` is the reader's unread count preference
 * (ADR-0038). With it off the row draws no number, and the count still says
 * whether the label reads as unread.
 */
export function useFeedUnreadCount({
  currentUserId,
  organizationId,
}: {
  currentUserId: string;
  organizationId: string | null;
}): { unreadCount: number; showCount: boolean } {
  const showCount = useShowRoomUnreadCount();
  const { data } = useQuery({
    queryKey: chatQueryKeys.feedUnread({
      userId: currentUserId,
      workspaceId: organizationId,
    }),
    queryFn: async () => (await fetchChatFeed({ limit: 1 })).unreadCount,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { unreadCount: data ?? 0, showCount };
}
