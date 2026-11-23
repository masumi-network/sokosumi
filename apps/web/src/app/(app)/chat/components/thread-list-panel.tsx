"use client";

import type { ChatRoomMessage, ChatRoomThread } from "@sokosumi/core-client";
import {
  hashKey,
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BellOff, Loader2, MessagesSquare, X } from "lucide-react";
import { useState } from "react";
import {
  listThreadsAction,
  markAllUnreadThreadsReadAction,
} from "@/app/chat/actions";
import { ChatEmptyState } from "@/app/chat/components/chat-unread-view-header";
import { messageSender } from "@/app/chat/components/room-helpers";
import {
  threadNeedsOverviewUnread,
  threadOverviewUnreadReplyCount,
} from "@/app/chat/utils/thread-overview-unread";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { ThreadListLoadMore } from "@/components/chat/thread-list-load-more";
import {
  ThreadGroupEmpty,
  ThreadGroupHeading,
  ThreadListRowContent,
  threadListRowClassName,
} from "@/components/chat/thread-list-row";
import { Button } from "@/components/ui/button";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { chatQueryKeys } from "@/queries/chat";

export interface ThreadListPanelLabels {
  title: string;
  markAllRead: string;
  empty: string;
  /** Under the empty title: how a Thread starts. None where none can. */
  emptyHint?: string;
  loading: string;
  error: string;
  markAllReadError: string;
  loadOlder: string;
  /** Heading over the Threads with unread replies. */
  groupUnread: string;
  /** Heading over the rest. */
  groupEarlier: string;
  /** Stands under an empty Unread heading: nothing here is unread. */
  groupUnreadEmpty: string;
  startedBy: (name: string) => string;
  /** Leads an unread row's second line: "2 new". */
  newReplies: (count: number) => string;
  /** Read by a screen reader off the muted row's icon. */
  muted: string;
  replies: (count: number) => string;
  close: string;
}

interface ThreadListPanelProps {
  roomId: string;
  userId?: string | null;
  /** Display names by member id, so a mention in a row reads as a name. */
  mentionNames?: ReadonlyMap<string, string>;
  labels: ThreadListPanelLabels;
  onOpenThread: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
  onClose: () => void;
  /**
   * Mark all reached Core. Names the loaded threads it left unread: Core skips
   * muted threads even when a mention in them is still unread (SOK-1087).
   */
  onAllThreadsLooked?: (stillUnreadParentIds: string[]) => void;
}

interface ThreadListPage {
  threads: ChatRoomThread[];
  nextCursor: string | null;
}

let nextThreadListVisitId = 0;

async function fetchThreadListPage(
  roomId: string,
  cursor: string | undefined,
  fallbackError: string,
): Promise<ThreadListPage> {
  let result: Awaited<ReturnType<typeof listThreadsAction>>;
  try {
    result = cursor
      ? await listThreadsAction(roomId, { cursor })
      : await listThreadsAction(roomId);
  } catch {
    throw new Error(fallbackError);
  }
  if (!result.ok) {
    throw new Error(result.error.message || fallbackError);
  }
  return result.value;
}

export function ThreadListPanel({
  roomId,
  userId,
  mentionNames,
  labels,
  onOpenThread,
  onClose,
  onAllThreadsLooked,
}: ThreadListPanelProps) {
  const queryClient = useQueryClient();
  const [visitId] = useState(() => ++nextThreadListVisitId);
  const [markingRoomId, setMarkingRoomId] = useState<string | null>(null);
  const [markAllError, setMarkAllError] = useState<{
    roomId: string;
    message: string;
  } | null>(null);
  const { formatTimeAgo } = useLocalizedDateTime();

  const queryKey = chatQueryKeys.threads({ userId }, roomId, visitId);
  const latestQueryKeyRef = useLatestRef(queryKey);
  const threadsQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchThreadListPage(roomId, pageParam, labels.error),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: "always",
  });

  const items: ChatRoomThread[] = [];
  const seenThreadIds = new Set<string>();
  for (const page of threadsQuery.data?.pages ?? []) {
    for (const item of page.threads) {
      if (!seenThreadIds.has(item.parentMessage.id)) {
        seenThreadIds.add(item.parentMessage.id);
        items.push(item);
      }
    }
  }

  const isMarkingAllRead = markingRoomId === roomId;
  const activeMarkAllError =
    markAllError?.roomId === roomId ? markAllError.message : null;
  // Kept off the list's own error: that one is the first page and Mark
  // all. A failed older page stays on this row, and a retry that lands
  // has to leave the row idle or scroll-loading never resumes.
  const firstPageError =
    threadsQuery.isError && !threadsQuery.isFetchNextPageError
      ? threadsQuery.error.message || labels.error
      : null;
  const error = activeMarkAllError ?? firstPageError;
  const isLoading = threadsQuery.isPending;

  function handleLoadOlder() {
    // Mark all holds the boundary too, but an observer entry queued before
    // that hold landed can still call in here.
    if (
      !threadsQuery.hasNextPage ||
      threadsQuery.isFetchingNextPage ||
      isMarkingAllRead
    ) {
      return;
    }
    void threadsQuery.fetchNextPage();
  }

  async function handleMarkAllRead() {
    if (isMarkingAllRead) {
      return;
    }
    const targetRoomId = roomId;
    const targetQueryKey = queryKey;
    const stillUnreadMutedIds = items
      .filter((item) => item.mutedAt != null && threadNeedsOverviewUnread(item))
      .map((item) => item.parentMessage.id);
    setMarkingRoomId(targetRoomId);
    setMarkAllError(null);
    try {
      const result = await markAllUnreadThreadsReadAction(targetRoomId);
      if (!result.ok) {
        setMarkAllError({
          roomId: targetRoomId,
          message: result.error.message || labels.markAllReadError,
        });
        return;
      }
      onAllThreadsLooked?.(stillUnreadMutedIds);
      await queryClient.cancelQueries({ queryKey: targetQueryKey });
      const targetQueryHash = hashKey(targetQueryKey);
      const isTargetActive = () => {
        if (hashKey(latestQueryKeyRef.current) !== targetQueryHash) {
          return false;
        }
        const query = queryClient.getQueryCache().find({
          queryKey: targetQueryKey,
          exact: true,
        });
        return query != null && query.getObserversCount() > 0;
      };
      try {
        const freshPage = await fetchThreadListPage(
          targetRoomId,
          undefined,
          labels.error,
        );
        if (!isTargetActive()) {
          return;
        }
        queryClient.setQueryData<
          InfiniteData<ThreadListPage, string | undefined>
        >(targetQueryKey, {
          pages: [freshPage],
          pageParams: [undefined],
        });
      } catch (reloadError) {
        if (!isTargetActive()) {
          return;
        }
        queryClient.setQueryData<
          InfiniteData<ThreadListPage, string | undefined>
        >(targetQueryKey, {
          pages: [{ threads: [], nextCursor: null }],
          pageParams: [undefined],
        });
        setMarkAllError({
          roomId: targetRoomId,
          message:
            reloadError instanceof Error && reloadError.message
              ? reloadError.message
              : labels.error,
        });
      }
    } catch {
      setMarkAllError({
        roomId: targetRoomId,
        message: labels.markAllReadError,
      });
    } finally {
      setMarkingRoomId((current) =>
        current === targetRoomId ? null : current,
      );
    }
  }

  // Two groups, so the eye finds where the unread stops instead of reading
  // each row's weight. A partition of what is loaded: nothing extra is
  // fetched, and Core returns unread first, so paging only grows Earlier.
  // While Mark all is on its way, every thread Core will mark shows as read
  // already. Core leaves muted threads alone (SOK-1087). A refused Mark all
  // ends this, and the unread rows are back.
  const shownItems = isMarkingAllRead
    ? items.map((item) =>
        item.mutedAt == null ? { ...item, unreadReplyCount: 0 } : item,
      )
    : items;
  const unreadItems = shownItems.filter((item) =>
    threadNeedsOverviewUnread(item),
  );
  const earlierItems = shownItems.filter(
    (item) => !threadNeedsOverviewUnread(item),
  );
  const showEmpty = !isLoading && !error && items.length === 0;
  // Every loaded list is divided, even one with nothing unread: the reader
  // scans for the Unread heading, so it answers them either way, with the rows
  // or with a line saying there are none. Only a room with no Threads at all
  // drops the headings, because there its own empty state already speaks.
  const hasGroups = items.length > 0;
  // The button stays while its write is open, so focus and the spinner
  // have somewhere to be.
  const showMarkAll = isMarkingAllRead || unreadItems.length > 0;

  function renderRow(item: ChatRoomThread) {
    const sender = messageSender(item.parentMessage);
    const lastAt = item.lastReplyAt;
    const isUnread = threadNeedsOverviewUnread(item);
    return (
      <button
        key={item.parentMessage.id}
        type="button"
        className={threadListRowClassName(isUnread)}
        onClick={() => {
          void onOpenThread(item.parentMessage);
        }}
        data-testid="thread-list-item"
        data-unread={isUnread ? "true" : "false"}
      >
        {/* The `@` waits on a per-Thread mention count from Core. An unread
            row leads with what is new and drops the starter to a trailing
            name; a read row says who started it and how long it runs. */}
        <ThreadListRowContent
          unread={isUnread}
          label={
            formatUnreadThreadsPreview(
              item.parentMessage.content,
              mentionNames,
            ) || sender.name
          }
          time={formatTimeAgo(
            lastAt instanceof Date ? lastAt : new Date(lastAt),
          )}
          newReplies={
            isUnread
              ? labels.newReplies(threadOverviewUnreadReplyCount(item))
              : undefined
          }
          meta={
            isUnread ? (
              sender.name
            ) : (
              <>
                {labels.startedBy(sender.name)}
                <span aria-hidden="true"> · </span>
                {labels.replies(item.replyCount)}
              </>
            )
          }
          trailing={
            item.mutedAt ? (
              <BellOff
                className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                aria-label={labels.muted}
                data-testid="thread-list-muted"
              />
            ) : undefined
          }
        />
      </button>
    );
  }

  return (
    <aside
      className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-[420px] lg:border-l"
      data-testid="thread-list-panel"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-sm font-semibold">{labels.title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {showMarkAll ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-auto shrink-0 px-2 py-1 text-xs font-normal"
              onClick={() => {
                void handleMarkAllRead();
              }}
              loading={isMarkingAllRead}
              data-testid="thread-list-mark-all-read"
            >
              {labels.markAllRead}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 md:size-8 rounded-full"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        {isLoading && items.length === 0 ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
            {labels.loading}
          </div>
        ) : null}
        {!isLoading && error ? (
          <p
            className="text-muted-foreground px-2 py-6 text-center text-sm"
            data-testid="thread-list-error"
          >
            {error}
          </p>
        ) : null}
        {showEmpty ? (
          <ChatEmptyState
            icon={MessagesSquare}
            title={labels.empty}
            description={labels.emptyHint}
            testId="thread-list-empty"
          />
        ) : null}
        {hasGroups ? (
          <>
            <ThreadGroupHeading count={unreadItems.length}>
              {labels.groupUnread}
            </ThreadGroupHeading>
            {unreadItems.length > 0 ? (
              unreadItems.map(renderRow)
            ) : (
              // Centred and given room, so it reads as the group's own state
              // rather than a row someone forgot to fill in.
              <ThreadGroupEmpty>{labels.groupUnreadEmpty}</ThreadGroupEmpty>
            )}
          </>
        ) : null}
        {/* Nothing read yet means no Earlier group to head; an empty one would
            only restate what the Unread group above already showed. */}
        {hasGroups && earlierItems.length > 0 ? (
          <>
            <ThreadGroupHeading>{labels.groupEarlier}</ThreadGroupHeading>
            {earlierItems.map(renderRow)}
          </>
        ) : null}
        {threadsQuery.hasNextPage ? (
          <ThreadListLoadMore
            boundaryKey={items.at(-1)?.parentMessage.id ?? ""}
            // Held while Mark all runs: an older page that starts during the
            // reload discards it, and the read rows would turn unread again.
            // The row shows busy for that time, which is true: the list is
            // being read again.
            status={
              threadsQuery.isFetchingNextPage || isMarkingAllRead
                ? "loading"
                : threadsQuery.isFetchNextPageError
                  ? "failed"
                  : "idle"
            }
            onLoad={handleLoadOlder}
            labels={{
              load: labels.loadOlder,
              error: labels.error,
              retry: labels.loadOlder,
            }}
          />
        ) : null}
      </div>
    </aside>
  );
}
