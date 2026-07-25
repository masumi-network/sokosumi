"use client";

import type { ReactElement, ReactNode, Ref } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { parseMentions, slugifyMentionValue } from "@/lib/utils/mention-parser";

import {
  createMentionSpan,
  deslugifyMentionSlug,
  findPositionForOffset,
  getActiveTrigger,
  getCaretRect,
  getMentionToken,
  getPopupPositionFromRect,
  isLineBreak,
  isMentionSpan,
  isWhitespaceChar,
  MENTION_CLASSNAME,
  serializeEditor,
  serializeEditorText,
  setCaretAfterNode,
  setEditorFromRaw,
  shouldAppendTrailingSpace,
  UNKNOWN_MENTION_CLASSNAME,
  type MentionDisplayResolver,
  type MentionRecordEntry,
  type NormalizedMention,
  type TriggerPosition,
} from "./mention-textarea-utils";

export type { MentionRecordEntry, NormalizedMention };

export interface MentionTextareaHandle {
  focus: () => void;
  insertText: (text: string) => void;
  openMentions: () => void;
}

interface MentionTextareaProps<TData = unknown> {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  mentions: Record<string, MentionRecordEntry<TData>>;
  placeholder?: string;
  className?: string;
  suggestionsAnchor?: "caret" | "editor";
  submitOnEnter?: boolean;
  onSubmitShortcut?: () => void;
  renderItem?: (
    mention: NormalizedMention<TData>,
    isActive: boolean,
  ) => ReactNode;
  onSelectedKeysChange?: (selectedKeys: string[]) => void;
}

function getFirstSerializedChar(node: Node): string | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "")[0];
  }

  if (isMentionSpan(node)) {
    return "@";
  }

  if (isLineBreak(node)) {
    return "\n";
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    for (const child of Array.from(node.childNodes)) {
      const char = getFirstSerializedChar(child);
      if (char) return char;
    }
  }

  return undefined;
}

function getPreviousNode(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.previousSibling) {
      current = current.previousSibling;
      while (current?.lastChild) {
        current = current.lastChild;
      }
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function getNextNode(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nextSibling) {
      current = current.nextSibling;
      while (current?.firstChild) {
        current = current.firstChild;
      }
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function getNextCharAfterNode(
  root: HTMLElement,
  node: Node,
): string | undefined {
  const nextNode = getNextNode(root, node);
  if (!nextNode) return undefined;
  return getFirstSerializedChar(nextNode);
}

function replaceRangeWithMention<TData>(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
  mention: NormalizedMention<TData>,
  appendSpace: boolean,
  resolveDisplay: MentionDisplayResolver,
): void {
  const range = document.createRange();
  const startPos = findPositionForOffset(root, startOffset);
  const endPos = findPositionForOffset(root, endOffset);
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  range.deleteContents();

  const { displayName, isKnown } = resolveDisplay(mention.key, mention.slug);
  const mentionSpan = createMentionSpan(
    mention.key,
    mention.slug,
    displayName,
    isKnown,
    {
      mentionClassName: MENTION_CLASSNAME,
      unknownMentionClassName: UNKNOWN_MENTION_CLASSNAME,
    },
  );

  range.insertNode(mentionSpan);
  let caretNode: Node = mentionSpan;
  if (appendSpace) {
    const spaceNode = document.createTextNode(" ");
    mentionSpan.after(spaceNode);
    caretNode = spaceNode;
  }
  setCaretAfterNode(root, caretNode);
}

function removeMentionAtSelection(
  root: HTMLElement,
  direction: "backward" | "forward",
): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent ?? "";
    if (direction === "backward" && range.startOffset === 0) {
      const previous = getPreviousNode(root, range.startContainer);
      if (previous && isMentionSpan(previous)) {
        previous.remove();
        return true;
      }
    }
    if (direction === "forward" && range.startOffset === text.length) {
      const next = getNextNode(root, range.startContainer);
      if (next && isMentionSpan(next)) {
        next.remove();
        return true;
      }
    }
    return false;
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer;
    if (direction === "backward" && range.startOffset > 0) {
      const nodeBefore = element.childNodes[range.startOffset - 1];
      if (nodeBefore && isMentionSpan(nodeBefore)) {
        nodeBefore.remove();
        return true;
      }
    }
    if (
      direction === "forward" &&
      range.startOffset < element.childNodes.length
    ) {
      const nodeAfter = element.childNodes[range.startOffset];
      if (nodeAfter && isMentionSpan(nodeAfter)) {
        nodeAfter.remove();
        return true;
      }
    }
  }

  return false;
}

function insertLineBreak(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return;

  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  setCaretAfterNode(root, br);
}

function insertPlainTextAtSelection(root: HTMLElement, text: string): void {
  const selection = window.getSelection();
  if (!selection) return;

  let range: Range;
  if (selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } else {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.addRange(range);
  }

  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  setCaretAfterNode(root, textNode);
}

function selectionIsInside(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }
  return root.contains(selection.getRangeAt(0).endContainer);
}

function setCaretAtEnd(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function MentionTextareaInner<TData = unknown>(
  {
    id,
    value,
    onChange,
    mentions,
    placeholder,
    className,
    suggestionsAnchor = "caret",
    submitOnEnter = false,
    onSubmitShortcut,
    renderItem,
    onSelectedKeysChange,
  }: MentionTextareaProps<TData>,
  ref: Ref<MentionTextareaHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] =
    useState<TriggerPosition | null>(null);
  const isSelectingRef = useRef(false);
  const editingMentionRef = useRef<HTMLSpanElement | null>(null);
  const manualMentionOpenRef = useRef(false);
  const lastSerializedValueRef = useRef<string>(value);

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

  const resolveDisplay = useCallback<MentionDisplayResolver>(
    (mentionKey: string, mentionSlug: string) => {
      const isKnown =
        keyToValue.has(mentionKey) || slugToValue.has(mentionSlug);
      const displayName =
        keyToValue.get(mentionKey) ??
        slugToValue.get(mentionSlug) ??
        slugToValue.get(slugifyMentionValue(mentionKey)) ??
        deslugifyMentionSlug(mentionSlug);

      return { displayName, isKnown };
    },
    [keyToValue, slugToValue],
  );

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

  const openSuggestions = useCallback(
    ({
      nextQuery,
      nextTriggerPosition,
      nextActiveIndex = 0,
    }: {
      nextQuery: string;
      nextTriggerPosition: TriggerPosition | null;
      nextActiveIndex?: number;
    }) => {
      setQuery(nextQuery);
      setIsOpen(true);
      setActiveIndex(nextActiveIndex);
      setTriggerPosition(nextTriggerPosition);
    },
    [],
  );

  const closeSuggestions = useCallback(() => {
    setIsOpen(false);
    setQuery(null);
    setActiveIndex(0);
    setTriggerPosition(null);
    manualMentionOpenRef.current = false;
    editingMentionRef.current = null;
  }, []);

  const resolveSuggestionsPosition = useCallback(
    (anchorRect: DOMRect | null): TriggerPosition | null => {
      const editor = editorRef.current;
      if (suggestionsAnchor === "editor" && editor) {
        return getPopupPositionFromRect(editor.getBoundingClientRect());
      }
      if (anchorRect) {
        return getPopupPositionFromRect(anchorRect);
      }
      return editor
        ? getPopupPositionFromRect(editor.getBoundingClientRect())
        : null;
    },
    [suggestionsAnchor],
  );

  const syncEditorValue = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return { text: "", caret: 0 };
    const result = serializeEditor(editor);
    lastSerializedValueRef.current = result.text;
    onChange(result.text);
    return result;
  }, [onChange]);

  const syncEditorValueAndMentions = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const { text, caret } = syncEditorValue();
    editingMentionRef.current = null;

    const trigger = getActiveTrigger(text, caret);
    if (trigger) {
      const caretRect = getCaretRect(editor);
      const fallbackRect = editor.getBoundingClientRect();
      const position = resolveSuggestionsPosition(caretRect ?? fallbackRect);
      manualMentionOpenRef.current = false;
      openSuggestions({
        nextQuery: trigger.query,
        nextTriggerPosition: position,
        nextActiveIndex: 0,
      });
      return;
    }

    closeSuggestions();
  }, [
    closeSuggestions,
    openSuggestions,
    resolveSuggestionsPosition,
    syncEditorValue,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (serializeEditorText(editor) === value) {
      lastSerializedValueRef.current = value;
      return;
    }
    setEditorFromRaw(editor, value, resolveDisplay, {
      mentionClassName: MENTION_CLASSNAME,
      unknownMentionClassName: UNKNOWN_MENTION_CLASSNAME,
    });
    lastSerializedValueRef.current = value;
  }, [resolveDisplay, value]);

  const insertMention = useCallback(
    (mention: NormalizedMention<TData>) => {
      const editor = editorRef.current;
      if (!editor) return;

      if (editingMentionRef.current) {
        const existingNode = editingMentionRef.current;
        const nextChar = getNextCharAfterNode(editor, existingNode);
        const appendSpace = shouldAppendTrailingSpace(nextChar);
        const { displayName, isKnown } = resolveDisplay(
          mention.key,
          mention.slug,
        );
        const mentionSpan = createMentionSpan(
          mention.key,
          mention.slug,
          displayName,
          isKnown,
          {
            mentionClassName: MENTION_CLASSNAME,
            unknownMentionClassName: UNKNOWN_MENTION_CLASSNAME,
          },
        );

        existingNode.replaceWith(mentionSpan);
        let caretNode: Node = mentionSpan;
        if (appendSpace) {
          const spaceNode = document.createTextNode(" ");
          mentionSpan.after(spaceNode);
          caretNode = spaceNode;
        }
        setCaretAfterNode(editor, caretNode);
        editingMentionRef.current = null;
        syncEditorValue();
        closeSuggestions();
        editor.focus();
        return;
      }

      const { text, caret } = serializeEditor(editor);
      const trigger = getActiveTrigger(text, caret);
      if (!trigger) {
        if (!manualMentionOpenRef.current) {
          closeSuggestions();
          return;
        }

        let insertionText = text;
        let insertionCaret = caret;
        if (
          insertionCaret > 0 &&
          !isWhitespaceChar(insertionText[insertionCaret - 1] ?? "")
        ) {
          insertPlainTextAtSelection(editor, " ");
          const result = serializeEditor(editor);
          insertionText = result.text;
          insertionCaret = result.caret;
        }

        const nextChar = insertionText[insertionCaret];
        replaceRangeWithMention(
          editor,
          insertionCaret,
          insertionCaret,
          mention,
          shouldAppendTrailingSpace(nextChar),
          resolveDisplay,
        );
        syncEditorValue();
        closeSuggestions();
        editor.focus();
        return;
      }

      const nextChar = text[caret];
      const appendSpace = shouldAppendTrailingSpace(nextChar);
      replaceRangeWithMention(
        editor,
        trigger.triggerStart,
        caret,
        mention,
        appendSpace,
        resolveDisplay,
      );
      syncEditorValue();
      closeSuggestions();
      editor.focus();
    },
    [closeSuggestions, resolveDisplay, syncEditorValue],
  );

  const handleInput = useCallback(() => {
    syncEditorValueAndMentions();
  }, [syncEditorValueAndMentions]);

  const insertText = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      insertPlainTextAtSelection(editor, text);
      syncEditorValueAndMentions();
    },
    [syncEditorValueAndMentions],
  );

  const openMentionSuggestions = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const hadEditorSelection = selectionIsInside(editor);
    editor.focus();
    if (!hadEditorSelection) {
      setCaretAtEnd(editor);
    }
    manualMentionOpenRef.current = true;
    openSuggestions({
      nextQuery: "",
      nextTriggerPosition: resolveSuggestionsPosition(null),
      nextActiveIndex: 0,
    });
  }, [openSuggestions, resolveSuggestionsPosition]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      insertText,
      openMentions: openMentionSuggestions,
    }),
    [insertText, openMentionSuggestions],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const editor = editorRef.current;
      if (!editor) return;

      if (event.key === "Backspace") {
        if (removeMentionAtSelection(editor, "backward")) {
          event.preventDefault();
          syncEditorValue();
          closeSuggestions();
          return;
        }
      }

      if (event.key === "Delete") {
        if (removeMentionAtSelection(editor, "forward")) {
          event.preventDefault();
          syncEditorValue();
          closeSuggestions();
          return;
        }
      }

      if (event.key === "Enter" && !isOpen) {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (submitOnEnter && !event.shiftKey) {
          onSubmitShortcut?.();
          return;
        }
        insertLineBreak(editor);
        syncEditorValue();
        return;
      }

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
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        const mention = filteredMentions[activeIndex];
        if (mention) {
          insertMention(mention);
        }
      }
    },
    [
      activeIndex,
      closeSuggestions,
      filteredMentions,
      insertMention,
      isOpen,
      onSubmitShortcut,
      submitOnEnter,
      syncEditorValue,
    ],
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setTimeout(() => {
      if (!isSelectingRef.current) {
        closeSuggestions();
      }
      isSelectingRef.current = false;
    }, 150);
  }, [closeSuggestions]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

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
    (mentionKey: string, mentionSlug: string, node: HTMLSpanElement) => {
      isSelectingRef.current = true;
      editingMentionRef.current = node;
      const rect = node.getBoundingClientRect();
      const position = getPopupPositionFromRect(rect);

      const clickedMentionIndex = normalizedMentions.findIndex(
        (mention) => mention.key === mentionKey || mention.slug === mentionSlug,
      );
      openSuggestions({
        nextQuery: "",
        nextTriggerPosition: position,
        nextActiveIndex: clickedMentionIndex >= 0 ? clickedMentionIndex : 0,
      });

      setTimeout(() => {
        editorRef.current?.focus();
      }, 0);
    },
    [normalizedMentions, openSuggestions],
  );

  const handleEditorMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const mentionSpan = target.closest("span[data-mention-key]");
      if (mentionSpan instanceof HTMLSpanElement) {
        event.preventDefault();
        isSelectingRef.current = true;
      }
    },
    [],
  );

  const handleEditorClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const mentionSpan = target.closest("span[data-mention-key]");
      if (!(mentionSpan instanceof HTMLSpanElement)) return;
      const mentionKey = mentionSpan.dataset.mentionKey;
      const mentionSlug = mentionSpan.dataset.mentionSlug;
      if (!mentionKey || !mentionSlug) return;
      event.preventDefault();
      event.stopPropagation();
      openMentionPopup(mentionKey, mentionSlug, mentionSpan);
    },
    [openMentionPopup],
  );

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeItem = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <div
        id={id}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onClick={handleEditorClick}
        onMouseDown={handleEditorMouseDown}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 caret-foreground text-foreground field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base wrap-break-word whitespace-pre-wrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
      />

      {!value && !isFocused && placeholder ? (
        <div
          aria-hidden
          className={cn(
            "text-muted-foreground pointer-events-none absolute inset-0 rounded-md px-3 py-2 text-base wrap-break-word whitespace-pre-wrap md:text-sm",
            className,
          )}
        >
          {placeholder}
        </div>
      ) : null}

      {isMounted &&
        isOpen &&
        filteredMentions.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            style={
              triggerPosition
                ? { top: triggerPosition.top, left: triggerPosition.left }
                : editorRef.current
                  ? {
                      top: editorRef.current.getBoundingClientRect().bottom,
                      left: editorRef.current.getBoundingClientRect().left,
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

export const MentionTextarea = forwardRef(MentionTextareaInner) as <
  TData = unknown,
>(
  props: MentionTextareaProps<TData> & { ref?: Ref<MentionTextareaHandle> },
) => ReactElement;
