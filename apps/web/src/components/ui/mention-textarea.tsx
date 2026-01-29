"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { parseMentions, slugifyMentionValue } from "@/lib/utils/mention-parser";

export interface MentionRecordEntry<TData = unknown> {
  value: string;
  slug?: string | null;
  data?: TData;
}

export interface NormalizedMention<TData = unknown> {
  key: string;
  value: string;
  slug: string;
  data?: TData;
}

interface MentionTextareaProps<TData = unknown> {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  mentions: Record<string, MentionRecordEntry<TData>>;
  placeholder?: string;
  className?: string;
  renderItem?: (
    mention: NormalizedMention<TData>,
    isActive: boolean,
  ) => ReactNode;
  onSelectedKeysChange?: (selectedKeys: string[]) => void;
}

interface TriggerPosition {
  top: number;
  left: number;
}

interface EditingRange {
  start: number;
  end: number;
}

const POPUP_HEIGHT_PX = 240; // max-h-60 = 15rem = 240px
const POPUP_WIDTH_PX = 288; // w-72 = 18rem = 288px
const VIEWPORT_PADDING_PX = 8;

function deslugifyMentionSlug(slug: string): string {
  return slug.replace(/-/g, " ");
}

function isWhitespaceChar(char: string): boolean {
  return char.trim() === "";
}

function shouldAppendTrailingSpace(nextChar: string | undefined): boolean {
  // Preserve existing behavior: insert a trailing space at end-of-text.
  if (nextChar === undefined || nextChar === "") return true;
  // Avoid double-spacing when we're inserting before existing whitespace/newlines.
  return !isWhitespaceChar(nextChar);
}

function getActiveTrigger(
  text: string,
  caret: number,
): { query: string; triggerStart: number } | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  if (clampedCaret === 0) return null;

  // Match the behavior of /@([^\s@]*)$/ against the text prefix.
  // Walk backward from caret to the start of the current token (whitespace boundary).
  let tokenStart = clampedCaret;
  while (tokenStart > 0 && !isWhitespaceChar(text[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }

  if (text[tokenStart] !== "@") return null;

  const query = text.slice(tokenStart + 1, clampedCaret);
  if (query.includes("@")) return null;

  return { query, triggerStart: tokenStart };
}

function replaceTextRange(
  text: string,
  range: EditingRange,
  insertion: string,
): { nextValue: string; nextCaret: number } {
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const nextValue = `${before}${insertion}${after}`;
  const nextCaret = before.length + insertion.length;
  return { nextValue, nextCaret };
}

function createTextareaMeasurementElement(
  textarea: HTMLTextAreaElement,
  textUpToTrigger: string,
): {
  measure: HTMLDivElement;
  marker: HTMLSpanElement;
  textareaStyle: CSSStyleDeclaration;
} {
  const textareaStyle = window.getComputedStyle(textarea);
  const measure = document.createElement("div");

  // Copy textarea styles exactly
  measure.style.position = "absolute";
  measure.style.visibility = "hidden";
  measure.style.whiteSpace = "pre-wrap";
  measure.style.wordBreak = "break-word";
  measure.style.font = textareaStyle.font;
  measure.style.padding = textareaStyle.padding;
  measure.style.border = textareaStyle.border;
  measure.style.width = textareaStyle.width;
  measure.style.lineHeight = textareaStyle.lineHeight;
  measure.style.letterSpacing = textareaStyle.letterSpacing;
  measure.style.top = "0";
  measure.style.left = "0";

  // Add text content with a marker span
  measure.textContent = textUpToTrigger;
  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space
  measure.appendChild(marker);

  return { measure, marker, textareaStyle };
}

export function MentionTextarea<TData = unknown>({
  id,
  value,
  onChange,
  mentions,
  placeholder,
  className,
  renderItem,
  onSelectedKeysChange,
}: MentionTextareaProps<TData>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] =
    useState<TriggerPosition | null>(null);
  const [editingRange, setEditingRange] = useState<EditingRange | null>(null);
  const isSelectingRef = useRef(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const normalizedMentions = useMemo(() => {
    const entries = Object.entries(mentions);
    const normalized: NormalizedMention<TData>[] = [];
    for (const [key, mention] of entries) {
      const mentionValue = mention.value;
      if (!mentionValue) continue;
      const slug = mention.slug
        ? mention.slug
        : slugifyMentionValue(mentionValue);
      if (!slug) continue;
      normalized.push({ key, value: mentionValue, slug, data: mention.data });
    }
    return normalized;
  }, [mentions]);

  const keyToValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const mention of normalizedMentions) {
      map.set(mention.key, mention.value);
    }
    return map;
  }, [normalizedMentions]);

  const slugToValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const mention of normalizedMentions) {
      map.set(mention.slug, mention.value);
    }
    return map;
  }, [normalizedMentions]);

  const slugToKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const mention of normalizedMentions) {
      map.set(mention.slug, mention.key);
    }
    return map;
  }, [normalizedMentions]);

  const filteredMentions = useMemo(() => {
    if (query === null || query === "") return normalizedMentions;
    const normalizedQuery = query.toLowerCase();
    return normalizedMentions.filter((mention) =>
      mention.value.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedMentions, query]);

  const selectedKeys = useMemo(() => {
    const parsed = parseMentions(value);
    const uniqueKeys: string[] = [];
    const seenKeys = new Set<string>();
    for (const mention of parsed) {
      const directKey = keyToValue.has(mention.id) ? mention.id : null;
      const slugKey =
        slugToKey.get(mention.slug) ??
        slugToKey.get(slugifyMentionValue(mention.id));
      const resolvedKey = directKey ?? slugKey ?? null;
      if (!resolvedKey) continue;
      if (seenKeys.has(resolvedKey)) continue;
      seenKeys.add(resolvedKey);
      uniqueKeys.push(resolvedKey);
    }
    return uniqueKeys;
  }, [keyToValue, slugToKey, value]);

  const lastSelectedKeysRef = useRef<string[]>([]);
  useEffect(() => {
    if (!onSelectedKeysChange) return;
    const previousKeys = lastSelectedKeysRef.current;
    if (
      previousKeys.length === selectedKeys.length &&
      previousKeys.every((key, index) => key === selectedKeys[index])
    ) {
      return;
    }

    lastSelectedKeysRef.current = selectedKeys;
    onSelectedKeysChange(selectedKeys);
  }, [onSelectedKeysChange, selectedKeys]);

  // Measure text position for popup placement
  const measureTextPosition = useCallback(
    (textUpToTrigger: string): TriggerPosition | null => {
      const textarea = textareaRef.current;
      const container = containerRef.current;
      if (!textarea || !container) return null;

      const { measure, marker, textareaStyle } =
        createTextareaMeasurementElement(textarea, textUpToTrigger);

      container.appendChild(measure);

      const markerRect = marker.getBoundingClientRect();

      // Account for textarea scroll position
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;

      // Calculate position relative to viewport, accounting for textarea scroll
      // (markerRect is in viewport coords, but our measurement element doesn't scroll)
      let top = markerRect.bottom - scrollTop;
      let left = markerRect.left - scrollLeft;

      // Ensure popup stays within reasonable bounds
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // If popup would go below viewport, position it above the trigger
      if (top + POPUP_HEIGHT_PX > viewportHeight - VIEWPORT_PADDING_PX) {
        // Position above the line instead
        const lineHeight = parseFloat(textareaStyle.lineHeight) || 20;
        top = top - lineHeight - POPUP_HEIGHT_PX;
        if (top < VIEWPORT_PADDING_PX) top = VIEWPORT_PADDING_PX;
      }

      // Clamp top position to viewport
      if (top < VIEWPORT_PADDING_PX) top = VIEWPORT_PADDING_PX;

      // Clamp left position to viewport
      if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;
      const maxLeft = viewportWidth - POPUP_WIDTH_PX - VIEWPORT_PADDING_PX;
      if (left > maxLeft && maxLeft > 0) left = maxLeft;

      container.removeChild(measure);

      return { top, left };
    },
    [],
  );

  const openSuggestions = useCallback(
    ({
      nextQuery,
      nextTriggerPosition,
      nextActiveIndex = 0,
      nextEditingRange = null,
    }: {
      nextQuery: string;
      nextTriggerPosition: TriggerPosition | null;
      nextActiveIndex?: number;
      nextEditingRange?: EditingRange | null;
    }) => {
      setQuery(nextQuery);
      setIsOpen(true);
      setActiveIndex(nextActiveIndex);
      setTriggerPosition(nextTriggerPosition);
      setEditingRange(nextEditingRange);
    },
    [],
  );

  const closeSuggestions = useCallback(() => {
    setIsOpen(false);
    setQuery(null);
    setActiveIndex(0);
    setTriggerPosition(null);
    setEditingRange(null);
  }, []);

  const insertMention = useCallback(
    (mention: NormalizedMention<TData>) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const mentionSlug = mention.slug;

      // If editing an existing mention, replace it
      if (editingRange) {
        const nextChar = value[editingRange.end];
        const insertion = `@${mention.key}:${mentionSlug}${
          shouldAppendTrailingSpace(nextChar) ? " " : ""
        }`;
        const { nextValue, nextCaret } = replaceTextRange(
          value,
          editingRange,
          insertion,
        );
        onChange(nextValue);
        closeSuggestions();

        setTimeout(() => {
          textarea.setSelectionRange(nextCaret, nextCaret);
          textarea.focus();
        }, 0);
        return;
      }

      // Otherwise, insert at current caret position (typing flow)
      const caret = textarea.selectionStart ?? value.length;
      const trigger = getActiveTrigger(value, caret);
      if (!trigger) {
        closeSuggestions();
        return;
      }

      const nextChar = value[caret];
      const insertion = `@${mention.key}:${mentionSlug}${
        shouldAppendTrailingSpace(nextChar) ? " " : ""
      }`;
      const { nextValue, nextCaret } = replaceTextRange(
        value,
        { start: trigger.triggerStart, end: caret },
        insertion,
      );

      onChange(nextValue);
      closeSuggestions();

      setTimeout(() => {
        textarea.setSelectionRange(nextCaret, nextCaret);
        textarea.focus();
      }, 0);
    },
    [closeSuggestions, editingRange, onChange, value],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      onChange(nextValue);

      // Clear editing range when typing
      setEditingRange(null);

      const caret = event.target.selectionStart ?? nextValue.length;
      const trigger = getActiveTrigger(nextValue, caret);

      if (trigger) {
        const textUpToTrigger = nextValue.slice(0, trigger.triggerStart);
        openSuggestions({
          nextQuery: trigger.query,
          nextTriggerPosition: measureTextPosition(textUpToTrigger),
          nextActiveIndex: 0,
          nextEditingRange: null,
        });
      } else {
        closeSuggestions();
      }
    },
    [closeSuggestions, measureTextPosition, onChange, openSuggestions],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeSuggestions();
        return;
      }

      if (filteredMentions.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) =>
          prev + 1 < filteredMentions.length ? prev + 1 : 0,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) =>
          prev - 1 >= 0 ? prev - 1 : filteredMentions.length - 1,
        );
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const mention = filteredMentions[activeIndex];
        if (mention) {
          insertMention(mention);
        }
      }
    },
    [activeIndex, closeSuggestions, filteredMentions, insertMention, isOpen],
  );

  const handleBlur = useCallback(() => {
    // Delay closing to allow click on dropdown items
    setTimeout(() => {
      if (!isSelectingRef.current) {
        closeSuggestions();
      }
      isSelectingRef.current = false;
    }, 150);
  }, [closeSuggestions]);

  const handleItemMouseDown = useCallback(() => {
    isSelectingRef.current = true;
  }, []);

  const handleItemClick = useCallback(
    (mention: NormalizedMention<TData>) => {
      insertMention(mention);
      isSelectingRef.current = false;
    },
    [insertMention],
  );

  const openMentionPopup = useCallback(
    (
      mentionKey: string,
      mentionSlug: string,
      mentionStart: number,
      mentionEnd: number,
    ) => {
      isSelectingRef.current = true;

      // Calculate position for the popup (text before the @)
      const textUpToMention = value.slice(0, mentionStart);
      const position = measureTextPosition(textUpToMention);

      // Open popup with full list (avoid filtering by slug; mention.name has spaces)
      const clickedMentionIndex = normalizedMentions.findIndex(
        (mention) =>
          mention.key === mentionKey || mention.slug === mentionSlug,
      );
      openSuggestions({
        nextQuery: "",
        nextTriggerPosition: position,
        nextActiveIndex: clickedMentionIndex >= 0 ? clickedMentionIndex : 0,
        nextEditingRange: { start: mentionStart, end: mentionEnd },
      });

      // Focus textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [measureTextPosition, normalizedMentions, openSuggestions, value],
  );

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeItem = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const handleMentionSpanClick = useCallback(
    (
      event: React.MouseEvent,
      mentionKey: string,
      mentionSlug: string,
      mentionStart: number,
      mentionEnd: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      openMentionPopup(mentionKey, mentionSlug, mentionStart, mentionEnd);
    },
    [openMentionPopup],
  );

  const renderHighlightedContent = useCallback(
    (text: string) => {
      const nodes: ReactNode[] = [];
      const allMentions = parseMentions(text);
      let lastIndex = 0;

      for (const mention of allMentions) {
        // Add text before this mention
        if (mention.start > lastIndex) {
          nodes.push(
            <span key={`text-${lastIndex}`}>
              {text.slice(lastIndex, mention.start)}
            </span>,
          );
        }

        const mentionKey = mention.id;
        const mentionSlug = mention.slug;
        const isKnownMention =
          keyToValue.has(mentionKey) || slugToValue.has(mentionSlug);

        // Always render human-friendly text (never a sluggy representation).
        // - Known mentions: show original name with spaces
        // - Unknown / partially edited mentions: de-slugify as a best-effort fallback
        const displayName =
          keyToValue.get(mentionKey) ??
          slugToValue.get(mentionSlug) ??
          slugToValue.get(slugifyMentionValue(mentionKey)) ??
          deslugifyMentionSlug(mentionSlug);

        nodes.push(
          <span
            key={`${mentionKey}-${mention.start}`}
            role="button"
            tabIndex={-1}
            onClick={(e) =>
              handleMentionSpanClick(
                e,
                mentionKey,
                mentionSlug,
                mention.start,
                mention.end,
              )
            }
            onMouseDown={(e) => {
              // Prevent textarea blur
              e.preventDefault();
              isSelectingRef.current = true;
            }}
            className={cn(
              "text-primary pointer-events-auto cursor-pointer font-semibold hover:underline",
              !isKnownMention && "opacity-80",
            )}
          >
            @{displayName}
          </span>,
        );

        lastIndex = mention.end;
      }

      // Add remaining text after last mention
      if (lastIndex < text.length) {
        nodes.push(
          <span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>,
        );
      }

      return nodes;
    },
    [handleMentionSpanClick, keyToValue, slugToValue],
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Actual textarea - positioned first for proper layering */}
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 caret-foreground field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base text-transparent transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
      />

      {/* Highlight overlay - on top of textarea to capture mention clicks */}
      <div
        aria-hidden
        className={cn(
          "text-foreground pointer-events-none absolute inset-0 overflow-hidden rounded-md px-3 py-2 text-base wrap-break-word whitespace-pre-line md:text-sm",
          className,
        )}
      >
        {value ? (
          renderHighlightedContent(value)
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </div>

      {/* Dropdown menu */}
      {isMounted &&
        isOpen &&
        filteredMentions.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            style={
              triggerPosition
                ? { top: triggerPosition.top, left: triggerPosition.left }
                : textareaRef.current
                  ? {
                      top: textareaRef.current.getBoundingClientRect().bottom,
                      left: textareaRef.current.getBoundingClientRect().left,
                    }
                  : undefined
            }
            className={cn(
              "bg-popover text-popover-foreground fixed z-50 max-h-60 w-72 overflow-y-auto rounded-md border p-1 shadow-md",
              !triggerPosition && "mt-1",
            )}
          >
            {filteredMentions.map((mention, index) => (
              <div
                key={mention.key}
                data-index={index}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={handleItemMouseDown}
                onClick={() => handleItemClick(mention)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {renderItem ? (
                  renderItem(mention, index === activeIndex)
                ) : (
                  <>
                    <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                      {mention.value.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate">{mention.value}</span>
                  </>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
