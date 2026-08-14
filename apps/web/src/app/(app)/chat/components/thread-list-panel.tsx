"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  listThreadsAction,
  markAllUnreadThreadsReadAction,
} from "@/app/chat/actions";
import { messageSender } from "@/app/chat/components/room-helpers";
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
  const requestIdRef = useRef(0);
  const { formatTimeAgo } = useLocalizedDateTime();

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    void listThreadsAction(roomId).then((result) => {
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (!result.ok) {
        setItems([]);
        setNextCursor(null);
        setError(result.error.message || labels.error);
        setIsLoading(false);
        return;
      }
      setItems(result.value.threads);
      setNextCursor(result.value.nextCursor);
      setIsLoading(false);
    });
    return () => {
      requestIdRef.current += 1;
    };
  }, [roomId, labels.error]);

  async function handleLoadOlder() {
    if (!nextCursor || isLoadingOlder) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoadingOlder(true);
    const result = await listThreadsAction(roomId, { cursor: nextCursor });
    if (requestId !== requestIdRef.current) {
      return;
    }
    if (!result.ok) {
      setError(result.error.message || labels.error);
      setIsLoadingOlder(false);
      return;
    }
    setItems((current) => [...current, ...result.value.threads]);
    setNextCursor(result.value.nextCursor);
    setIsLoadingOlder(false);
  }

  async function handleMarkAllRead() {
    if (isMarkingAllRead) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsMarkingAllRead(true);
    setError(null);
    const result = await markAllUnreadThreadsReadAction(roomId);
    if (requestId !== requestIdRef.current) {
      return;
    }
    if (!result.ok) {
      setError(result.error.message || labels.markAllReadError);
      setIsMarkingAllRead(false);
      return;
    }
    setItems((current) =>
      current
        .map((item) =>
          item.unreadReplyCount > 0
            ? { ...item, unreadReplyCount: 0, lastUnreadReplyAt: null }
            : item,
        )
        .toSorted((a, b) => {
          const aAt = new Date(a.lastReplyAt).getTime();
          const bAt = new Date(b.lastReplyAt).getTime();
          return bAt - aAt;
        }),
    );
    setIsMarkingAllRead(false);
    onAllThreadsLooked?.();
  }

  const unreadCount = items.filter((item) => item.unreadReplyCount > 0).length;
  const showEmpty = !isLoading && !error && items.length === 0;
  const showMarkAll = unreadCount > 0;

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
          const isUnread = item.unreadReplyCount > 0;
          return (
            <button
              key={item.parentMessage.id}
              type="button"
              className={cn(
                "hover:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
              )}
              onClick={() => {
                void onOpenThread(item.parentMessage);
              }}
              data-testid="thread-list-item"
            >
              <div className="flex items-start gap-2">
                <span className="line-clamp-2 min-w-0 flex-1 font-medium">
                  {preview}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatTimeAgo(
                    lastAt instanceof Date ? lastAt : new Date(lastAt),
                  )}
                </span>
              </div>
              <p className="text-muted-foreground truncate text-xs">
                {labels.startedBy(sender.name)}
                <span aria-hidden="true"> · </span>
                <span className="text-foreground font-medium">
                  {isUnread
                    ? labels.unreadReplies(item.unreadReplyCount)
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
