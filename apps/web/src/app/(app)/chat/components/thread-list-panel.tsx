"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  listThreadsAction,
  markAllUnreadThreadsReadAction,
} from "@/app/chat/actions";
import { messageSender } from "@/app/chat/components/room-helpers";
import {
  threadNeedsOverviewAttention,
  threadOverviewAttentionReplyCount,
} from "@/app/chat/utils/thread-overview-attention";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { Button } from "@/components/ui/button";
import type {
  ChatRoomMessage,
  ChatRoomThread,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface ThreadListPanelLabels {
  title: string;
  markAllRead: string;
  empty: string;
  loading: string;
  error: string;
  markAllReadError: string;
  loadOlder: string;
  startedBy: (name: string) => string;
  unreadReplies: (count: number) => string;
  replies: (count: number) => string;
  close: string;
}

interface ThreadListPanelProps {
  roomId: string;
  labels: ThreadListPanelLabels;
  onOpenThread: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
  onClose: () => void;
  onAllThreadsLooked?: () => void;
}

export function ThreadListPanel({
  roomId,
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
      onAllThreadsLooked?.();
      await loadFirstPage();
    } catch {
      setError(labels.markAllReadError);
    } finally {
      setIsMarkingAllRead(false);
    }
  }

  const attentionCount = items.filter((item) =>
    threadNeedsOverviewAttention(item),
  ).length;
  const showEmpty = !isLoading && !error && items.length === 0;
  const showMarkAll = attentionCount > 0;

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
        {items.map((item) => {
          const sender = messageSender(item.parentMessage);
          const lastAt = item.lastReplyAt;
          const preview =
            formatUnreadThreadsPreview(item.parentMessage.content) ||
            sender.name;
          const needsAttention = threadNeedsOverviewAttention(item);
          const attentionReplyLabelCount =
            threadOverviewAttentionReplyCount(item);
          return (
            <button
              key={item.parentMessage.id}
              type="button"
              className={cn(
                "hover:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                needsAttention && "bg-accent/40",
              )}
              onClick={() => {
                void onOpenThread(item.parentMessage);
              }}
              data-testid="thread-list-item"
              data-needs-attention={needsAttention ? "true" : "false"}
            >
              <div className="flex items-start gap-2">
                {needsAttention ? (
                  <span
                    aria-hidden="true"
                    data-testid="thread-list-unread-dot"
                    className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                  />
                ) : (
                  <span className="mt-1.5 size-2 shrink-0" aria-hidden />
                )}
                <span
                  className={cn(
                    "line-clamp-2 min-w-0 flex-1",
                    needsAttention
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground font-normal",
                  )}
                >
                  {preview}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatTimeAgo(
                    lastAt instanceof Date ? lastAt : new Date(lastAt),
                  )}
                </span>
              </div>
              <p
                className={cn(
                  "truncate pl-4 text-xs",
                  needsAttention
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {labels.startedBy(sender.name)}
                <span aria-hidden="true"> · </span>
                <span>
                  {needsAttention
                    ? labels.unreadReplies(attentionReplyLabelCount)
                    : labels.replies(item.replyCount)}
                </span>
              </p>
            </button>
          );
        })}
        {nextCursor ? (
          <div className="flex justify-center py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleLoadOlder();
              }}
              disabled={isLoadingOlder}
              data-testid="thread-list-load-older"
            >
              {isLoadingOlder ? labels.loading : labels.loadOlder}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
