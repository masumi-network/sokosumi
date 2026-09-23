"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { ChatCaughtUp } from "@/app/chat/components/chat-unread-view-header";
import { resolveUnreadThreadsAttention } from "@/components/chat/room-attention";
import { ThreadListLoadMore } from "@/components/chat/thread-list-load-more";
import { ThreadGroupEmpty } from "@/components/chat/thread-list-row";
import { UnreadThreadLink } from "@/components/chat/unread-thread-link";
import { Button } from "@/components/ui/button";
import type { ChatRoom } from "@/lib/clients/generated/core";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

import { fetchChatUnreadThreads } from "./fetch-chat-threads";

interface UnreadThreadsListProps {
  /** The reader's rooms: names each row's room and drives the refetch. */
  rooms: readonly ChatRoom[];
  /**
   * The rooms are a live read rather than a cache. Only then may a zero in
   * their counts say the reader is caught up before Core does.
   */
  roomsLive: boolean;
  /**
   * Core's first page read with the page request, and the rooms that request
   * rendered with. The page answers those rooms only.
   */
  initial?: {
    page: ChatUnreadThreadsPage;
    rooms: readonly ChatRoom[];
  } | null;
  currentUserId: string;
  /**
   * `flyout` says a drained list with the caught-up mark; `page` with one
   * line under its Unread heading, since the Earlier group follows it.
   */
  variant: "flyout" | "page";
}

/**
 * What the rooms say about their unread Threads, as one string: per room its
 * reply and Thread totals and the Threads it lists. It moves exactly when a
 * Thread is read, muted or gains a reply, including a read and a new reply
 * that leave the totals level, so the list reads Core again then and not on
 * every message. The next sidebar poll is what drives it, the way it drives
 * the inset rows.
 */
export function unreadThreadsFingerprint(rooms: readonly ChatRoom[]): string {
  return rooms
    .filter((room) => room.mutedAt == null)
    .map((room) =>
      [
        room.id,
        room.threadUnreadCount ?? 0,
        room.unreadThreadCount ?? 0,
        ...(room.unreadThreads ?? []).map(
          (thread) => `${thread.parentMessageId}/${thread.unreadReplyCount}`,
        ),
      ].join(":"),
    )
    .join(",");
}

type UnreadThreadsInitial = UnreadThreadsListProps["initial"];

/**
 * The unread Threads read, keyed by the rooms' fingerprint. The list reads
 * it, and the sidebar's Threads row reads it too, ahead of the pointer, so
 * the flyout opens onto rows rather than a spinner.
 */
export function useUnreadThreadsQuery({
  rooms,
  initial = null,
  enabled = true,
}: {
  rooms: readonly ChatRoom[];
  initial?: UnreadThreadsInitial;
  enabled?: boolean;
}) {
  const fingerprint = unreadThreadsFingerprint(rooms);
  // initialData is fresh for the app query client's 60s staleTime. Only the
  // rooms the server page was rendered with may claim it; a live fingerprint
  // that has already moved must read Core, or the stale page sticks.
  const serverFingerprint = initial
    ? unreadThreadsFingerprint(initial.rooms)
    : null;
  return useInfiniteQuery({
    queryKey: ["chat", "unread-threads", fingerprint],
    queryFn: ({ pageParam }) => fetchChatUnreadThreads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData:
      initial && fingerprint === serverFingerprint
        ? { pages: [initial.page], pageParams: [undefined] }
        : undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Every unread Thread across the reader's rooms (SOK-1159), newest unread
 * reply first, each naming its room: the Threads flyout on the desktop
 * sidebar and the `/chat/threads` page. Opening one opens the
 * Thread in its room; reading it removes it on the next read of the rooms,
 * and at zero the list says the reader is caught up.
 */
export function UnreadThreadsList({
  rooms,
  roomsLive,
  initial = null,
  currentUserId,
  variant,
}: UnreadThreadsListProps) {
  const t = useTranslations("App.Channels.ThreadsView");
  const tGroups = useTranslations("App.Channels.UnreadThreads");
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const { threadCount } = resolveUnreadThreadsAttention(rooms);
  // Live rooms at zero already answer: nothing to ask Core. An empty roster
  // that is not a live answer is a gap, not caught up, so it waits.
  const roomsSayCaughtUp = roomsLive && threadCount === 0;
  const waitingForRooms = !roomsLive && rooms.length === 0;
  const query = useUnreadThreadsQuery({
    rooms,
    initial,
    enabled: !roomsSayCaughtUp && !waitingForRooms,
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
    roomsSayCaughtUp ||
    (query.isSuccess &&
      threads.length === 0 &&
      // A page whose rows were all dropped says nothing while another follows.
      !query.hasNextPage &&
      (fetched.length === 0 || rooms.length > 0));

  return (
    <>
      {caughtUp ? (
        variant === "flyout" ? (
          <ChatCaughtUp
            title={t("empty")}
            description={t("emptyDescription")}
          />
        ) : (
          <ThreadGroupEmpty>{tGroups("groupUnreadEmpty")}</ThreadGroupEmpty>
        )
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
            className="flex flex-col gap-0.5"
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
                load: t("loadMore"),
                loading: tGroups("loading"),
                error: t("loadError"),
                retry: t("retry"),
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
