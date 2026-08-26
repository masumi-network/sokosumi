"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { messageSender } from "@/app/chat/components/room-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

const SEARCH_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

export interface RoomSearchPanelLabels {
  open: string;
  placeholder: string;
  idle: string;
  empty: string;
  loading: string;
  error: string;
  replyBadge: string;
}

interface RoomSearchPanelProps {
  roomId: string;
  labels: RoomSearchPanelLabels;
  onJumpToMessage: (hit: ChatRoomMessage) => void;
}

export function RoomSearchPanel({
  roomId,
  labels,
  onJumpToMessage,
}: RoomSearchPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<ChatRoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const { formatTimeAgo } = useLocalizedDateTime();

  const searchMessages = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    if (!searchQuery) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await coreClient.getChatRoomMessages(roomId, {
        q: searchQuery,
        limit: SEARCH_PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResults(response.data);
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResults([]);
      setError(labels.error);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void searchMessages(debouncedQuery);
  }, [debouncedQuery, open, roomId]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }
    setOpen(nextOpen);
  }

  function handleSelect(hit: ChatRoomMessage) {
    onJumpToMessage(hit);
    handleOpenChange(false);
  }

  const showIdle = !debouncedQuery && !isLoading && !error;
  const showEmpty =
    Boolean(debouncedQuery) && !isLoading && !error && results.length === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={labels.open}
          data-testid="room-search-trigger"
        >
          <Search className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-2rem,24rem)] p-0"
        data-testid="room-search-panel"
      >
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            data-testid="room-search-input"
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {isLoading && results.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {labels.loading}
            </div>
          ) : null}
          {!isLoading && error ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {error}
            </p>
          ) : null}
          {showIdle ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {labels.idle}
            </p>
          ) : null}
          {showEmpty ? (
            <p
              className="text-muted-foreground px-2 py-6 text-center text-sm"
              data-testid="room-search-empty"
            >
              {labels.empty}
            </p>
          ) : null}
          {results.map((message) => {
            const sender = messageSender(message);
            const isReply = message.parentMessageId != null;
            return (
              <button
                key={message.id}
                type="button"
                className={cn(
                  "hover:bg-accent flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                )}
                onClick={() => handleSelect(message)}
                data-testid="room-search-result"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{sender.name}</span>
                  {isReply ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {labels.replyBadge}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {formatTimeAgo(new Date(message.createdAt))}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-xs">
                  {message.content}
                </p>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
