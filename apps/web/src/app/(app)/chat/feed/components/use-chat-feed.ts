"use client";

import type { ChatFeed } from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchChatFeed } from "@/components/chat/fetch-chat-feed";
import { chatQueryKeys } from "@/queries/chat";

/**
 * The Feed's pages, newest first. The server's first page seeds the cache;
 * when that read failed, the first page is read here instead.
 */
export function useChatFeed({
  initialPage,
  currentUserId,
  organizationId,
}: {
  initialPage: ChatFeed | null;
  currentUserId: string;
  organizationId: string | null;
}) {
  return useInfiniteQuery({
    queryKey: chatQueryKeys.feedPages({
      userId: currentUserId,
      workspaceId: organizationId,
    }),
    queryFn: ({ pageParam }) => fetchChatFeed({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [undefined] }
      : undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
