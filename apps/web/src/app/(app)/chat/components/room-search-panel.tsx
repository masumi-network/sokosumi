"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { messageSender } from "@/app/chat/components/room-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useIsMobile } from "@/hooks/use-mobile";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

const SEARCH_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_HOTKEY = "f";

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const { formatTimeAgo } = useLocalizedDateTime();

  // Below the mobile breakpoint there is no physical keyboard, so the hotkey
  // stays unbound and the hint stays out of the tooltip.
  const isMobile = useIsMobile();
  const isApplePlatform = useIsApplePlatform();
  const shortcutLabel = isApplePlatform ? "⌘F" : "Ctrl+F";
  const shortcutKeys = isApplePlatform ? "Meta+F" : "Control+F";

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
      setActiveIndex(0);
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

  /** Returns false when the press belongs to find-in-page instead. */
  const openFromHotkey = useEffectEvent(() => {
    // A second press while the field already has focus falls through to
    // find-in-page, so the browser shortcut stays reachable.
    if (open && document.activeElement === inputRef.current) {
      return false;
    }
    setOpen(true);
    return true;
  });

  useEffect(() => {
    if (isMobile) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== SEARCH_HOTKEY || event.repeat) {
        return;
      }

      const hostModifier = isApplePlatform ? event.metaKey : event.ctrlKey;
      if (!hostModifier || event.altKey || event.shiftKey) {
        return;
      }

      if (openFromHotkey()) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isApplePlatform, isMobile]);

  function closeSearch() {
    // Hits never outlive the surface that showed them. The query survives so
    // reopening re-runs the search from where the user left off.
    setResults([]);
    setActiveIndex(0);
    setError(null);
    // A surviving query means the next open starts a fetch, so hand the
    // reopen a loading state. Without it the first frame reads "no matches"
    // for a query that has hits.
    setIsLoading(Boolean(debouncedQuery));
    requestIdRef.current += 1;
    setOpen(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    closeSearch();
  }

  function handleSelect(hit: ChatRoomMessage) {
    onJumpToMessage(hit);
    closeSearch();
  }

  /** Escape means "clear", wherever focus happens to be when it is pressed. */
  function clearQuery() {
    setQuery("");
    setDebouncedQuery("");
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      const hit = results[activeIndex];
      if (hit) {
        event.preventDefault();
        handleSelect(hit);
      }
    }
  }

  const showIdle = !debouncedQuery && !isLoading && !error;
  const showEmpty =
    Boolean(debouncedQuery) && !isLoading && !error && results.length === 0;
  const activeOptionId = results[activeIndex]
    ? `${optionIdPrefix}-${results[activeIndex].id}`
    : undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={labels.open}
              aria-keyshortcuts={isMobile ? undefined : shortcutKeys}
              data-testid="room-search-trigger"
              className="size-8"
            >
              <Search className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {labels.open}
          {isMobile ? null : (
            <kbd className="ml-2 font-sans tracking-widest opacity-70">
              {shortcutLabel}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,24rem)] p-0"
        data-testid="room-search-panel"
        onEscapeKeyDown={clearQuery}
      >
        <div className="relative border-b p-2">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2"
            strokeWidth={1.5}
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={labels.placeholder}
            aria-label={labels.open}
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            data-testid="room-search-input"
            className="h-8 pl-8"
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label={labels.open}
          className="max-h-80 overflow-y-auto p-1"
        >
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
          {results.map((message, index) => {
            const sender = messageSender(message);
            const isReply = message.parentMessageId != null;
            const isActive = index === activeIndex;
            return (
              <div
                key={message.id}
                id={`${optionIdPrefix}-${message.id}`}
                role="option"
                aria-selected={isActive}
                tabIndex={-1}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                  isActive && "bg-accent",
                )}
                onClick={() => handleSelect(message)}
                onMouseEnter={() => setActiveIndex(index)}
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
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
