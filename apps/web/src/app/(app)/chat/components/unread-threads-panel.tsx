"use client";

import { Loader2, MessagesSquare } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  listUnreadThreadsAction,
  markAllUnreadThreadsReadAction,
} from "@/app/chat/actions";
import { messageSender } from "@/app/chat/components/room-helpers";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  ChatRoomMessage,
  ChatRoomThread,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface UnreadThreadsPanelLabels {
  open: string;
  title: string;
  markAllRead: string;
  empty: string;
  loading: string;
  error: string;
  markAllReadError: string;
  startedBy: (name: string) => string;
  unreadReplies: (count: number) => string;
}

interface UnreadThreadsPanelProps {
  roomId: string;
  labels: UnreadThreadsPanelLabels;
  /** Returns true when thread look-state was persisted successfully. */
  onOpenThread: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
}

function UnreadThreadsBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      data-testid="unread-threads-badge"
      aria-hidden="true"
      className="bg-primary text-primary-foreground absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] leading-4 font-semibold tabular-nums"
    >
      {label}
    </span>
  );
}

export function UnreadThreadsPanel({
  roomId,
  labels,
  onOpenThread,
}: UnreadThreadsPanelProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatRoomThread[]>([]);
  const [badgeCount, setBadgeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const requestIdRef = useRef(0);
  const { formatTimeAgo } = useLocalizedDateTime();

  const loadUnreadThreads = useEffectEvent(
    async (options?: { forPanel?: boolean }) => {
      const forPanel = options?.forPanel === true;
      const requestId = ++requestIdRef.current;
      if (forPanel) {
        setIsLoading(true);
        setError(null);
      }

      const result = await listUnreadThreadsAction(roomId);
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (!result.ok) {
        if (forPanel) {
          setItems([]);
          setError(result.message || labels.error);
          setIsLoading(false);
        }
        return;
      }

      setBadgeCount(result.data.length);
      if (forPanel) {
        setItems(result.data);
        setIsLoading(false);
      }
    },
  );

  useEffect(() => {
    void loadUnreadThreads({ forPanel: false });
  }, [roomId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadUnreadThreads({ forPanel: true });
  }, [open, roomId]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      setIsMarkingAllRead(false);
      requestIdRef.current += 1;
    }
    setOpen(nextOpen);
  }

  async function handleSelect(item: ChatRoomThread) {
    handleOpenChange(false);
    const marked = await onOpenThread(item.parentMessage);
    if (marked) {
      setBadgeCount((current) => Math.max(0, current - 1));
    }
  }

  async function handleMarkAllRead() {
    if (isMarkingAllRead || badgeCount <= 0) {
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
      setError(result.message || labels.markAllReadError);
      setIsMarkingAllRead(false);
      return;
    }

    setItems([]);
    setBadgeCount(0);
    setIsMarkingAllRead(false);
  }

  const showEmpty = !isLoading && !error && items.length === 0;
  const showMarkAll = badgeCount > 0 || items.length > 0;
  const triggerLabel =
    badgeCount > 0 ? `${labels.open} (${badgeCount})` : labels.open;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={triggerLabel}
          data-testid="unread-threads-trigger"
          className="relative"
        >
          <MessagesSquare className="size-4" />
          <UnreadThreadsBadge count={badgeCount} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,24rem)] p-0"
        data-testid="unread-threads-panel"
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-medium">{labels.title}</p>
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
              data-testid="unread-threads-mark-all-read"
            >
              {isMarkingAllRead ? labels.loading : labels.markAllRead}
            </Button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {isLoading && items.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {labels.loading}
            </div>
          ) : null}
          {!isLoading && error ? (
            <p
              className="text-muted-foreground px-2 py-6 text-center text-sm"
              data-testid="unread-threads-error"
            >
              {error}
            </p>
          ) : null}
          {showEmpty ? (
            <p
              className="text-muted-foreground px-2 py-6 text-center text-sm"
              data-testid="unread-threads-empty"
            >
              {labels.empty}
            </p>
          ) : null}
          {items.map((item) => {
            const sender = messageSender(item.parentMessage);
            const lastAt = item.lastUnreadReplyAt ?? item.lastReplyAt;
            const preview =
              formatUnreadThreadsPreview(item.parentMessage.content) ||
              sender.name;
            return (
              <button
                key={item.parentMessage.id}
                type="button"
                className={cn(
                  "hover:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                )}
                onClick={() => {
                  void handleSelect(item);
                }}
                data-testid="unread-threads-item"
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
                    {labels.unreadReplies(item.unreadReplyCount)}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
