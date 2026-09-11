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
  const [isFocused, setIsFocused] = useState(false);
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

  // On desktop the field rests as an icon and grows into a field while it
  // has focus, results, or a query. Mobile always shows the full field
  // because it only mounts inside the popover.
  const isExpanded = isMobile || isFocused || open || query !== "";

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

  /** The hotkey toggles: a press on a focused field puts it away again. */
  const toggleFromHotkey = useEffectEvent(() => {
    if (document.activeElement === inputRef.current) {
      // The close would otherwise hand focus straight back to the field.
      interactedOutsideRef.current = open;
      clearQuery();
      closeSearch();
      inputRef.current?.blur();
      return;
    }

    focusField();
    if (query) {
      setOpen(true);
    }
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

      event.preventDefault();
      toggleFromHotkey();
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

  /** A second Escape on an already-empty field gives it back to the icon. */
  function clearOrCollapse() {
    if (query) {
      clearQuery();
      return;
    }
    inputRef.current?.blur();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // While the surface is open, Escape belongs to the dismissable layer, so
    // the key means the same thing wherever focus sits. Once it is closed
    // that layer is gone, and the field is still holding the query Escape is
    // meant to clear.
    if (!open) {
      if (event.key === "Escape") {
        event.preventDefault();
        clearOrCollapse();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && query) {
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

  // Typing runs ahead of the debounce, so the idle hint and the empty state
  // follow the live query; the gap in between reads as loading.
  const liveQuery = query.trim();
  const isPending = liveQuery !== debouncedQuery;
  const showLoading =
    results.length === 0 && (isLoading || (isPending && liveQuery !== ""));
  // A stale error yields to the loading state once the next fetch is due.
  const showError = Boolean(error) && !isLoading && !isPending;
  const showIdle = !liveQuery && !isLoading && !error;
  const showEmpty =
    Boolean(debouncedQuery) &&
    !isPending &&
    !isLoading &&
    !error &&
    results.length === 0;
  const activeOptionId =
    open && results[activeIndex]
      ? `${optionIdPrefix}-${results[activeIndex].id}`
      : undefined;

  const searchField = (
    <div
      ref={fieldRef}
      data-testid="room-search-field"
      data-state={isExpanded ? "expanded" : "collapsed"}
      className={cn(
        "relative transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        isMobile ? "w-full" : isExpanded ? "w-56 xl:w-64" : "w-8",
      )}
    >
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 transition-colors",
          isExpanded ? "text-muted-foreground" : "text-foreground",
        )}
      />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          if (nextQuery.trim() !== "") {
            setOpen(true);
            return;
          }
          // Hits must not outlive the query, or the next keystroke reopens
          // on the previous fetch. Mobile keeps the popover because the
          // field lives inside it.
          setDebouncedQuery("");
          setResults([]);
          setActiveIndex(0);
          setError(null);
          setIsLoading(false);
          requestIdRef.current += 1;
          if (!isMobile) {
            setOpen(false);
          }
        }}
        onClick={() => {
          if (query) {
            setOpen(true);
          }
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
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
          "peer h-8 pl-8 placeholder:transition-opacity placeholder:duration-200",
          // The gutter has to clear the hint without clipping the placeholder,
          // and "Ctrl+F" is far wider than "⌘F".
          isMobile ? "pr-3" : isApplePlatform ? "pr-12" : "pr-16",
          // Collapsed, the field passes for the ghost icon button next to it.
          !isExpanded &&
            "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 cursor-pointer border-transparent dark:bg-transparent placeholder:opacity-0",
        )}
      />
      {isMobile ? null : (
        <kbd
          aria-hidden
          className={cn(
            "text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-xs tracking-widest whitespace-nowrap",
            "transition-[opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] peer-focus:opacity-0",
            (query || !isExpanded) && "opacity-0",
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
            <Search className="size-4" />
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
          {showLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {labels.loading}
            </div>
          ) : null}
          {showError ? (
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
