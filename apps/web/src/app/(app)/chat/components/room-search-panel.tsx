"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { messageSender } from "@/app/chat/components/room-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const interactedOutsideRef = useRef(false);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const { formatTimeAgo } = useLocalizedDateTime();

  // Below the mobile breakpoint there is no physical keyboard, so the field
  // collapses into the header icon and the hotkey stays unbound.
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

  function focusField() {
    // On mobile the field only mounts with the popover, so wait a frame.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  /** Returns false when the press belongs to find-in-page instead. */
  const openFromHotkey = useEffectEvent(() => {
    // A press while the surface is already open and focused falls through to
    // find-in-page, so the browser shortcut stays reachable. Once the surface
    // is closed the shortcut belongs to search again, even though the field
    // below it kept focus.
    if (open && document.activeElement === inputRef.current) {
      return false;
    }

    setOpen(true);
    focusField();
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

  function isEventInsideField(target: EventTarget | null) {
    return (
      target instanceof Node && fieldRef.current?.contains(target) === true
    );
  }

  function closeSearch() {
    // Hits never outlive the surface that showed them. Keeping them would
    // leave Enter and the arrow keys acting on a list nobody can see. The
    // query itself does survive, because the field stays on screen and
    // emptying it under the user would look like data loss; reopening
    // re-runs the search from that query.
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
      // The exit animation can cancel an unmount before onCloseAutoFocus
      // consumes this, which would leave the next close without its restore.
      interactedOutsideRef.current = false;
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
    // While the surface is open, Escape belongs to the dismissable layer, so
    // the key means the same thing wherever focus sits. Once it is closed
    // that layer is gone, and the field is still holding the query Escape is
    // meant to clear.
    if (!open) {
      if (event.key === "Escape") {
        event.preventDefault();
        clearQuery();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

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
  const activeOptionId =
    open && results[activeIndex]
      ? `${optionIdPrefix}-${results[activeIndex].id}`
      : undefined;

  const searchField = (
    <div
      ref={fieldRef}
      className={cn("relative", isMobile ? "w-full" : "w-56 xl:w-64")}
    >
      <Search
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        strokeWidth={1.5}
      />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={handleInputKeyDown}
        placeholder={labels.placeholder}
        aria-label={labels.open}
        aria-keyshortcuts={isMobile ? undefined : shortcutKeys}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        data-testid="room-search-input"
        className={cn(
          "peer h-8 pl-8",
          // The gutter has to clear the hint without clipping the placeholder,
          // and "Ctrl+F" is far wider than "⌘F".
          isMobile ? "pr-3" : isApplePlatform ? "pr-12" : "pr-16",
        )}
      />
      {isMobile ? null : (
        <kbd
          aria-hidden
          className={cn(
            "text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-xs tracking-widest whitespace-nowrap",
            "transition-[opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] peer-focus:opacity-0",
            query && "opacity-0",
          )}
        >
          {shortcutLabel}
        </kbd>
      )}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        {isMobile ? (
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={labels.open}
            data-testid="room-search-trigger"
            className="size-8"
            onClick={() => {
              setOpen(true);
              focusField();
            }}
          >
            <Search className="size-4" strokeWidth={1.5} />
          </Button>
        ) : (
          searchField
        )}
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,24rem)] p-0"
        data-testid="room-search-panel"
        // The header field is the anchor, not part of the content, so Radix
        // reads focusing or clicking it as an outside interaction and would
        // close the surface the hotkey just opened.
        onFocusOutside={(event) => {
          if (isEventInsideField(event.detail.originalEvent.target)) {
            event.preventDefault();
            return;
          }
          interactedOutsideRef.current = true;
        }}
        onPointerDownOutside={(event) => {
          if (isEventInsideField(event.detail.originalEvent.target)) {
            event.preventDefault();
            return;
          }
          interactedOutsideRef.current = true;
        }}
        onEscapeKeyDown={clearQuery}
        // There is no PopoverTrigger any more, so Radix has no element to
        // return focus to and would drop it on the body. It also no longer
        // withholds that restore after an outside interaction, so match what
        // a trigger would have done and leave the user where they clicked.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (interactedOutsideRef.current) {
            interactedOutsideRef.current = false;
            return;
          }
          (isMobile ? triggerRef : inputRef).current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          // Desktop keeps focus in the header field; mobile focuses the field
          // that mounts inside this popover.
          if (!isMobile) {
            event.preventDefault();
          }
        }}
      >
        {isMobile ? <div className="border-b p-2">{searchField}</div> : null}
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
