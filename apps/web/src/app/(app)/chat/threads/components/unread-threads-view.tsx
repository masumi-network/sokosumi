"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  ChatCaughtUp,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { resolveUnreadThreadsAttention } from "@/components/chat/room-attention";
import { UnreadThreadLink } from "@/components/chat/unread-thread-link";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { Button } from "@/components/ui/button";
import type { ChatRoom } from "@/lib/clients/generated/core";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

import { fetchChatUnreadThreads } from "./fetch-chat-unread-threads";

interface UnreadThreadsViewProps {
  /** Core's first page at request time, or null when that read failed. */
  initialPage: ChatUnreadThreadsPage | null;
  /** The rooms as the sidebar cache held them, until the live read lands. */
  initialRooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * What the rooms say about their unread Threads, as one string. It changes
 * exactly when a Thread is read, muted or gains a reply, so the list reads
 * Core again then and not otherwise: the next sidebar poll is what drives it,
 * the way it drives the inset rows.
 */
function unreadThreadsFingerprint(rooms: readonly ChatRoom[]): string {
  return rooms
    .filter((room) => room.mutedAt == null)
    .map((room) => `${room.id}:${room.threadUnreadCount ?? 0}`)
    .join(",");
}

/**
 * The Threads view (SOK-1159): every unread Thread across the reader's rooms,
 * newest unread reply first, each naming its room. Opening one opens the
 * Thread in its room; reading it removes it here on the next read of the
 * rooms, and at zero the view says the reader is caught up.
 */
export function UnreadThreadsView({
  initialPage,
  initialRooms,
  currentUserId,
}: UnreadThreadsViewProps) {
  const t = useTranslations("App.Channels.ThreadsView");
  const liveRooms = useLiveChatRooms();
  const rooms = liveRooms.length > 0 ? liveRooms : initialRooms;
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const fingerprint = unreadThreadsFingerprint(rooms);
  // initialData is fresh for the app query client's 60s staleTime. Only the
  // rooms this page was rendered with may claim it; a live fingerprint that
  // has already moved must read Core, or the stale page sticks.
  const serverFingerprint = unreadThreadsFingerprint(initialRooms);
  const { threadCount } = resolveUnreadThreadsAttention(rooms);

  const query = useInfiniteQuery({
    queryKey: ["chat", "unread-threads", fingerprint],
    queryFn: ({ pageParam }) => fetchChatUnreadThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData:
      initialPage && fingerprint === serverFingerprint
        ? { pages: [initialPage], pageParams: [undefined] }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const seen = new Set<string>();
  const fetched = (query.data?.pages ?? []).flatMap((page) => page.threads);
  const threads = fetched.filter((thread) => {
    // A room muted or left since the page was read lists nothing here, as
    // it lists nothing in the sidebar.
    const room = roomsById.get(thread.roomId);
    if (!room || room.mutedAt != null || seen.has(thread.parentMessageId)) {
      return false;
    }
    seen.add(thread.parentMessageId);
    return true;
  });
  // The rooms are the faster signal: the view drains the moment their count
  // does, without waiting on Core to agree. Before any room has loaded, only
  // Core's own empty answer says so.
  const caughtUp =
    (liveRooms.length > 0 && threadCount === 0) ||
    (query.isSuccess &&
      threads.length === 0 &&
      (fetched.length === 0 || rooms.length > 0));

  return (
    <div className="flex flex-col gap-5 pb-4">
      <ChatUnreadViewHeader title={t("title")} />
      {caughtUp ? (
        <ChatCaughtUp title={t("empty")} description={t("emptyDescription")} />
      ) : query.isError && threads.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">{t("loadError")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : query.isPending ? (
        <Loader2
          className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none"
          aria-label={t("listLabel")}
        />
      ) : (
        <>
          <ul
            aria-label={t("listLabel")}
            className="flex flex-col gap-1"
            data-testid="unread-threads-list"
          >
            {threads.map((thread) => {
              const room = roomsById.get(thread.roomId);
              return room ? (
                <li key={thread.parentMessageId}>
                  <UnreadThreadLink
                    thread={thread}
                    room={room}
                    currentUserId={currentUserId}
                    size="md"
                  />
                </li>
              ) : null;
            })}
          </ul>
          {query.hasNextPage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={query.isFetchingNextPage}
              aria-busy={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {t("loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
