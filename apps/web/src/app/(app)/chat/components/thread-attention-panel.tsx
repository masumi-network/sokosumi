"use client";

import { Loader2, MessagesSquare } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { listThreadAttentionAction } from "@/app/chat/actions";
import { messageSender } from "@/app/chat/components/room-helpers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  ChatRoomMessage,
  ChatRoomThreadAttentionItem,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface ThreadAttentionPanelLabels {
  open: string;
  title: string;
  empty: string;
  loading: string;
  error: string;
  unreadReplies: (count: number) => string;
}

interface ThreadAttentionPanelProps {
  roomId: string;
  labels: ThreadAttentionPanelLabels;
  onOpenThread: (parent: ChatRoomMessage) => void;
}

export function ThreadAttentionPanel({
  roomId,
  labels,
  onOpenThread,
}: ThreadAttentionPanelProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatRoomThreadAttentionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const { formatTimeAgo } = useLocalizedDateTime();

  const loadAttention = useEffectEvent(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    const result = await listThreadAttentionAction(roomId);
    if (requestId !== requestIdRef.current) {
      return;
    }

    if (!result.ok) {
      setItems([]);
      setError(result.message || labels.error);
      setIsLoading(false);
      return;
    }

    setItems(result.data);
    setIsLoading(false);
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadAttention();
  }, [open, roomId]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }
    setOpen(nextOpen);
  }

  function handleSelect(item: ChatRoomThreadAttentionItem) {
    onOpenThread(item.parentMessage);
    handleOpenChange(false);
  }

  const showEmpty = !isLoading && !error && items.length === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={labels.open}
          data-testid="thread-attention-trigger"
        >
          <MessagesSquare className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,24rem)] p-0"
        data-testid="thread-attention-panel"
      >
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">{labels.title}</p>
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
              data-testid="thread-attention-error"
            >
              {error}
            </p>
          ) : null}
          {showEmpty ? (
            <p
              className="text-muted-foreground px-2 py-6 text-center text-sm"
              data-testid="thread-attention-empty"
            >
              {labels.empty}
            </p>
          ) : null}
          {items.map((item) => {
            const sender = messageSender(item.parentMessage);
            const lastAt = item.lastUnreadReplyAt;
            return (
              <button
                key={item.parentMessage.id}
                type="button"
                className={cn(
                  "hover:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                )}
                onClick={() => handleSelect(item)}
                data-testid="thread-attention-item"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{sender.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {formatTimeAgo(
                      lastAt instanceof Date ? lastAt : new Date(lastAt),
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-xs">
                  {item.parentMessage.content}
                </p>
                <p className="text-foreground text-xs font-medium">
                  {labels.unreadReplies(item.unreadReplyCount)}
                </p>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
