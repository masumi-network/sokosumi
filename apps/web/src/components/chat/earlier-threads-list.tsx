"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { ThreadListLoadMore } from "@/components/chat/thread-list-load-more";
import { ThreadGroupHeading } from "@/components/chat/thread-list-row";
import { EarlierThreadLink } from "@/components/chat/unread-thread-link";
import { unreadThreadsFingerprint } from "@/components/chat/unread-threads-list";
import { Button } from "@/components/ui/button";
import type { ChatRoom } from "@/lib/clients/generated/core";

import { fetchChatEarlierThreads } from "./fetch-chat-threads";

interface EarlierThreadsListProps {
  rooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * The Threads view's Earlier group (SOK-1159): the reader's Threads with
 * nothing unread, newest reply first, under the unread ones, as a room's own
 * Thread list groups them. Reads again when the rooms' Thread counts move,
 * which is when a Thread crosses between the two groups. Absent, heading
 * included, while its first read is out and while there is none.
 */
export function EarlierThreadsList({
  rooms,
  currentUserId,
}: EarlierThreadsListProps) {
  const t = useTranslations("App.Channels.UnreadThreads");
  const tView = useTranslations("App.Channels.ThreadsView");
  const headingId = useId();
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  const query = useInfiniteQuery({
    queryKey: ["chat", "earlier-threads", unreadThreadsFingerprint(rooms)],
    queryFn: ({ pageParam }) => fetchChatEarlierThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const seen = new Set<string>();
  const threads = (query.data?.pages ?? [])
    .flatMap((page) => page.threads)
    .filter((thread) => {
      const room = roomsById.get(thread.roomId);
      if (!room || room.mutedAt != null || seen.has(thread.parentMessageId)) {
        return false;
      }
      seen.add(thread.parentMessageId);
      return true;
    });

  // Nothing until there is something to show: a heading over a spinner that
  // then vanished would flash for every reader with no read Thread.
  if (query.isPending || (query.isSuccess && threads.length === 0)) {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <ThreadGroupHeading id={headingId}>
        {t("groupEarlier")}
      </ThreadGroupHeading>
      {query.isError && threads.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2">
          <p className="text-muted-foreground text-sm">{t("error")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {tView("retry")}
          </Button>
        </div>
      ) : (
        <>
          <ul
            className="flex flex-col gap-0.5"
            data-testid="earlier-threads-list"
          >
            {threads.map((thread) => {
              const room = roomsById.get(thread.roomId);
              return room ? (
                <li key={thread.parentMessageId}>
                  <EarlierThreadLink
                    thread={thread}
                    room={room}
                    currentUserId={currentUserId}
                  />
                </li>
              ) : null;
            })}
          </ul>
          {query.hasNextPage ? (
            <ThreadListLoadMore
              boundaryKey={threads.at(-1)?.parentMessageId ?? ""}
              status={
                query.isFetchingNextPage
                  ? "loading"
                  : query.isFetchNextPageError
                    ? "failed"
                    : "idle"
              }
              onLoad={() => void query.fetchNextPage()}
              labels={{
                load: t("loadOlder"),
                loading: t("loading"),
                error: t("error"),
                retry: tView("retry"),
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
