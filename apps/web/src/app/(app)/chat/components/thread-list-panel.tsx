"use client";

import { Loader2, MegaphoneOff, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  listThreadsAction,
  markAllUnreadThreadsReadAction,
} from "@/app/chat/actions";
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
import type {
  ChatRoomMessage,
  ChatRoomThread,
} from "@/lib/clients/generated/core";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface ThreadListPanelLabels {
  title: string;
  markAllRead: string;
  empty: string;
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

export function ThreadListPanel({
  roomId,
  mentionNames,
  labels,
  onOpenThread,
  onClose,
  onAllThreadsLooked,
}: ThreadListPanelProps) {
  const [items, setItems] = useState<ChatRoomThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const listRequestIdRef = useRef(0);
  const { formatTimeAgo } = useLocalizedDateTime();

  const loadFirstPage = useEffectEvent(async () => {
    const requestId = ++listRequestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await listThreadsAction(roomId);
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      if (!result.ok) {
        setItems([]);
        setNextCursor(null);
        setError(result.error.message || labels.error);
        return;
      }
      setItems(result.value.threads);
      setNextCursor(result.value.nextCursor);
    } catch {
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      setItems([]);
      setNextCursor(null);
      setError(labels.error);
    } finally {
      if (requestId === listRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    void loadFirstPage();
    return () => {
      listRequestIdRef.current += 1;
    };
  }, [roomId]);

  async function handleLoadOlder() {
    if (!nextCursor || isLoadingOlder) {
      return;
    }
    const requestId = ++listRequestIdRef.current;
    setIsLoadingOlder(true);
    try {
      const result = await listThreadsAction(roomId, { cursor: nextCursor });
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message || labels.error);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.parentMessage.id));
        return [
          ...current,
          ...result.value.threads.filter(
            (item) => !seen.has(item.parentMessage.id),
          ),
        ];
      });
      setNextCursor(result.value.nextCursor);
    } catch {
      if (requestId === listRequestIdRef.current) {
        setError(labels.error);
      }
    } finally {
      setIsLoadingOlder(false);
    }
  }

  async function handleMarkAllRead() {
    if (isMarkingAllRead) {
      return;
    }
    setIsMarkingAllRead(true);
    setError(null);
    try {
      const result = await markAllUnreadThreadsReadAction(roomId);
      if (!result.ok) {
        setError(result.error.message || labels.markAllReadError);
        return;
      }
      onAllThreadsLooked?.(
        items
          .filter(
            (item) => item.mutedAt != null && threadNeedsOverviewUnread(item),
          )
          .map((item) => item.parentMessage.id),
      );
      await loadFirstPage();
    } catch {
      setError(labels.markAllReadError);
    } finally {
      setIsMarkingAllRead(false);
    }
  }

  // Two groups, so the eye finds where the unread stops instead of reading
  // each row's weight. A partition of what is loaded: nothing extra is
  // fetched, and Core returns unread first, so paging only grows Earlier.
  const unreadItems = items.filter((item) => threadNeedsOverviewUnread(item));
  const earlierItems = items.filter((item) => !threadNeedsOverviewUnread(item));
  const showEmpty = !isLoading && !error && items.length === 0;
  // Every loaded list is divided, even one with nothing unread: the reader
  // scans for the Unread heading, so it answers them either way, with the rows
  // or with a line saying there are none. Only a room with no Threads at all
  // drops the headings, because there its own empty state already speaks.
  const hasGroups = items.length > 0;
  const showMarkAll = unreadItems.length > 0;

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
              <MegaphoneOff
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
              disabled={isMarkingAllRead}
              data-testid="thread-list-mark-all-read"
            >
              {isMarkingAllRead ? labels.loading : labels.markAllRead}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {isLoading && items.length === 0 ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
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
          <p
            className="text-muted-foreground px-2 py-6 text-center text-sm"
            data-testid="thread-list-empty"
          >
            {labels.empty}
          </p>
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
        {nextCursor ? (
          <ThreadListLoadMore
            boundaryKey={items.at(-1)?.parentMessage.id ?? ""}
            status={
              isLoadingOlder
                ? "loading"
                : error && items.length > 0
                  ? "failed"
                  : "idle"
            }
            onLoad={() => {
              void handleLoadOlder();
            }}
            labels={{
              load: labels.loadOlder,
              loading: labels.loading,
              error: labels.error,
              retry: labels.loadOlder,
            }}
          />
        ) : null}
      </div>
    </aside>
  );
}
