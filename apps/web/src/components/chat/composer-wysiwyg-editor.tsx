"use client";

import type { ReactNode, Ref } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  createMentionSpan,
  deslugifyMentionSlug,
  findPositionForOffset,
  getActiveTrigger,
  getCaretRect,
  getPopupPositionFromRect,
  MENTION_CLASSNAME,
  type MentionRecordEntry,
  type NormalizedMention,
  serializeEditor,
  setCaretAfterNode,
  shouldAppendTrailingSpace,
  type TriggerPosition,
  UNKNOWN_MENTION_CLASSNAME,
  VIEWPORT_PADDING_PX,
} from "@/components/ui/mention-textarea-utils";
import { cn } from "@/lib/utils";
import {
  type ComposerActiveFormats,
  getComposerActiveFormats,
} from "@/lib/utils/composer-active-formats";
import type { ComposerFormatCommand } from "@/lib/utils/composer-format-command";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "@/lib/utils/composer-markdown-dom";
import { tryExitComposerInlineFormatOnArrow } from "@/lib/utils/composer-wysiwyg-arrow-exit";
import { toggleComposerInlineCode } from "@/lib/utils/composer-wysiwyg-code-format";
import {
  resolveComposerEnterAction,
  tryApplyComposerInputRuleAtCaret,
} from "@/lib/utils/composer-wysiwyg-input-rules";
import { normalizeUrl } from "@/lib/utils/markdown-editor-utils";
import { parseMentions, slugifyMentionValue } from "@/lib/utils/mention-parser";

export interface ComposerWysiwygEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
  openMentions: () => void;
  applyFormat: (command: ComposerFormatCommand) => void;
  insertLink: (text: string, url: string) => void;
  getSelectedPlainText: () => string;
}

interface ComposerWysiwygEditorProps<TData = unknown> {
  ref?: Ref<ComposerWysiwygEditorHandle>;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  mentions?: Record<string, MentionRecordEntry<TData>>;
  placeholder?: string;
  className?: string;
  onSubmitShortcut?: () => void;
  onLinkShortcut?: () => void;
  onActiveFormatsChange?: (formats: ComposerActiveFormats) => void;
  onSelectedKeysChange?: (selectedKeys: string[]) => void;
  renderMentionItem?: (
    mention: NormalizedMention<TData>,
    isActive: boolean,
  ) => ReactNode;
}

const EDITOR_PROSE_CLASSNAME = cn(
  "[&_em]:italic [&_i]:italic [&_strong]:font-bold [&_b]:font-bold",
  "[&_u]:underline [&_s]:line-through [&_strike]:line-through [&_del]:line-through",
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_pre]:whitespace-pre",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
  "[&_a]:text-primary [&_a]:underline",
  "[&_blockquote]:border-muted-foreground/40 [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
  "[&_li]:ml-4 [&_ol>li]:list-decimal [&_ul>li]:list-disc",
  "[&_span[data-mention-key]]:text-primary [&_span[data-mention-key]]:cursor-pointer [&_span[data-mention-key]]:font-semibold [&_span[data-mention-key]]:hover:underline",
);

function insertLineBreak(editor: HTMLElement): void {
  editor.focus();
  let didInsert = false;
  try {
    didInsert = document.execCommand("insertLineBreak");
  } catch {
    didInsert = false;
  }
  if (!didInsert) {
    try {
      didInsert = document.execCommand("insertHTML", false, "<br>");
    } catch {
      didInsert = false;
    }
  }
  if (!didInsert) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

export function ComposerWysiwygEditor<TData = unknown>({
  ref,
  id,
  value,
  onChange,
  mentions = {},
  placeholder = "",
  className,
  onSubmitShortcut,
  onLinkShortcut,
  onActiveFormatsChange,
  onSelectedKeysChange,
  renderMentionItem,
}: ComposerWysiwygEditorProps<TData>) {
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const isInternalChange = useRef(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualMentionOpenRef = useRef(false);
  const onActiveFormatsChangeRef = useRef(onActiveFormatsChange);
  onActiveFormatsChangeRef.current = onActiveFormatsChange;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] =
    useState<TriggerPosition | null>(null);

  const normalizedMentions = useMemo(() => {
    const entries = Object.entries(mentions);
    const normalized: NormalizedMention<TData>[] = [];

    for (const [key, mention] of entries) {
      if (!mention.value) continue;
      const slug = mention.slug
        ? mention.slug
        : slugifyMentionValue(mention.value);
      if (!slug) continue;
      normalized.push({
        key,
        value: mention.value,
        slug,
        data: mention.data,
      });
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

  const resolveMentionDisplay = useCallback(
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
  }, []);

  const syncFromEditor = useCallback(() => {
    if (!editorRef.current) {
      return { markdown: "", text: "", caret: 0 };
    }

    const markdown = htmlToMarkdown(editorRef.current);
    const { text, caret } = serializeEditor(editorRef.current);
    onChange(markdown);
    return { markdown, text, caret };
  }, [onChange]);

  const publishActiveFormats = useCallback(() => {
    const notify = onActiveFormatsChangeRef.current;
    if (!notify) return;
    notify(getComposerActiveFormats(editorRef.current));
  }, []);

  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      const currentHtml = editorRef.current.innerHTML;
      const newHtml = markdownToHtml(value, resolveMentionDisplay);
      const isFocused = editorRef.current.contains(document.activeElement);
      const isExternalClear = value.trim().length === 0;

      if (currentHtml !== newHtml && (!isFocused || isExternalClear)) {
        editorRef.current.innerHTML = newHtml || "";
      }
    }
    isInternalChange.current = false;
  }, [value, resolveMentionDisplay]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;

    tryApplyComposerInputRuleAtCaret(editorRef.current);

    isInternalChange.current = true;
    const { text, caret } = syncFromEditor();
    publishActiveFormats();

    if (manualMentionOpenRef.current && normalizedMentions.length > 0) {
      const caretRect = getCaretRect(editorRef.current);
      const fallbackRect = editorRef.current.getBoundingClientRect();
      const position = caretRect
        ? getPopupPositionFromRect(caretRect)
        : getPopupPositionFromRect(fallbackRect);
      openSuggestions({
        nextQuery: "",
        nextTriggerPosition: position,
        nextActiveIndex: 0,
      });
      return;
    }

    if (normalizedMentions.length === 0) {
      closeSuggestions();
      return;
    }

    const trigger = getActiveTrigger(text, caret);
    if (trigger) {
      const caretRect = getCaretRect(editorRef.current);
      const fallbackRect = editorRef.current.getBoundingClientRect();
      const position = caretRect
        ? getPopupPositionFromRect(caretRect)
        : getPopupPositionFromRect(fallbackRect);
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
    normalizedMentions.length,
    openSuggestions,
    publishActiveFormats,
    syncFromEditor,
  ]);

  const insertMention = useCallback(
    (mention: NormalizedMention<TData>) => {
      if (!editorRef.current) return;

      const { text, caret } = serializeEditor(editorRef.current);
      const trigger = getActiveTrigger(text, caret);

      const range = document.createRange();
      if (trigger) {
        const startPos = findPositionForOffset(
          editorRef.current,
          trigger.triggerStart,
        );
        const endPos = findPositionForOffset(editorRef.current, caret);
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        range.deleteContents();
      } else {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          range.setStart(
            selection.getRangeAt(0).startContainer,
            selection.getRangeAt(0).startOffset,
          );
          range.collapse(true);
        } else {
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
        }
      }

      const nextChar = trigger ? text[caret] : undefined;
      const { displayName, isKnown } = resolveMentionDisplay(
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

      range.insertNode(mentionSpan);
      let caretNode: Node = mentionSpan;
      if (shouldAppendTrailingSpace(nextChar)) {
        const spaceNode = document.createTextNode(" ");
        mentionSpan.after(spaceNode);
        caretNode = spaceNode;
      }

      setCaretAfterNode(editorRef.current, caretNode);
      isInternalChange.current = true;
      syncFromEditor();
      closeSuggestions();
      editorRef.current.focus();
    },
    [closeSuggestions, resolveMentionDisplay, syncFromEditor],
  );

  const execCommand = useCallback(
    (command: string, commandValue?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, commandValue);
      handleInput();
      // queryCommandState for typing style can settle after the command;
      // refresh toolbar pressed state on the next frame.
      requestAnimationFrame(() => {
        publishActiveFormats();
      });
    },
    [handleInput, publishActiveFormats],
  );

  const insertText = useCallback(
    (text: string) => {
      editorRef.current?.focus();
      let didInsert = false;
      try {
        didInsert = document.execCommand("insertText", false, text);
      } catch {
        didInsert = false;
      }

      if (!didInsert) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (editorRef.current) {
          editorRef.current.appendChild(document.createTextNode(text));
        }
      }

      handleInput();
    },
    [handleInput],
  );

  const insertHtml = useCallback(
    (html: string) => {
      editorRef.current?.focus();
      let didInsert = false;
      try {
        didInsert = document.execCommand("insertHTML", false, html);
      } catch {
        didInsert = false;
      }

      if (!didInsert && editorRef.current) {
        editorRef.current.insertAdjacentHTML("beforeend", html);
      }

      handleInput();
    },
    [handleInput],
  );

  const insertLink = useCallback(
    (label: string, url: string) => {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) return;

      editorRef.current?.focus();
      const selectedText = window.getSelection()?.toString() ?? "";
      if (
        selectedText.trim().length > 0 &&
        label.trim() === selectedText.trim()
      ) {
        execCommand("createLink", normalizedUrl);
        return;
      }

      const safeLabel = label.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeUrl = normalizedUrl.replace(/"/g, "&quot;");
      insertHtml(`<a href="${safeUrl}">${safeLabel || "link"}</a>`);
    },
    [execCommand, insertHtml],
  );

  const applyFormat = useCallback(
    (command: ComposerFormatCommand) => {
      switch (command) {
        case "bold":
          execCommand("bold");
          return;
        case "italic":
          execCommand("italic");
          return;
        case "underline":
          execCommand("underline");
          return;
        case "strikethrough":
          execCommand("strikeThrough");
          return;
        case "code": {
          if (!editorRef.current) return;
          editorRef.current.focus();
          toggleComposerInlineCode(editorRef.current);
          handleInput();
          requestAnimationFrame(() => {
            publishActiveFormats();
          });
          return;
        }
        case "codeBlock": {
          const text = window.getSelection()?.toString() ?? "";
          const escapedText = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          insertHtml(`<pre><code>${escapedText}</code></pre>`);
          return;
        }
        case "quote":
          execCommand("formatBlock", "blockquote");
          return;
        case "bulletList":
          execCommand("insertUnorderedList");
          return;
        case "numberedList":
          execCommand("insertOrderedList");
          return;
        default: {
          const _exhaustive: never = command;
          throw new Error(`Unhandled composer format: ${_exhaustive}`);
        }
      }
    },
    [execCommand, handleInput, insertHtml, publishActiveFormats],
  );

  const openMentions = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    manualMentionOpenRef.current = true;
    const caretRect = getCaretRect(editor);
    const fallbackRect = editor.getBoundingClientRect();
    const position = caretRect
      ? getPopupPositionFromRect(caretRect)
      : getPopupPositionFromRect(fallbackRect);
    openSuggestions({
      nextQuery: "",
      nextTriggerPosition: position,
      nextActiveIndex: 0,
    });
  }, [openSuggestions]);

  const getCurrentTriggerAtCaret = useCallback(() => {
    if (!editorRef.current) return null;
    const { text, caret } = serializeEditor(editorRef.current);
    return getActiveTrigger(text, caret);
  }, []);

  const syncMentionSuggestionsWithCaret = useCallback(() => {
    publishActiveFormats();
    if (!isOpen) return;
    if (manualMentionOpenRef.current) return;
    const trigger = getCurrentTriggerAtCaret();
    if (!trigger) {
      closeSuggestions();
    }
  }, [
    closeSuggestions,
    getCurrentTriggerAtCaret,
    isOpen,
    publishActiveFormats,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      const currentTrigger = getCurrentTriggerAtCaret();
      const isMentionDropdownVisible = isOpen && filteredMentions.length > 0;
      const isCaretOnMentionTrigger =
        Boolean(currentTrigger) || manualMentionOpenRef.current;
      const isMentionKeyboardActive =
        isMentionDropdownVisible && isCaretOnMentionTrigger;

      if (isMentionKeyboardActive && !hasModifier) {
        if (key === "escape") {
          event.preventDefault();
          closeSuggestions();
          return;
        }

        if (key === "arrowdown") {
          event.preventDefault();
          setActiveIndex((prev) =>
            prev + 1 < filteredMentions.length ? prev + 1 : 0,
          );
          return;
        }

        if (key === "arrowup") {
          event.preventDefault();
          setActiveIndex((prev) =>
            prev - 1 >= 0 ? prev - 1 : filteredMentions.length - 1,
          );
          return;
        }

        if (key === "enter" || key === "tab") {
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          const mention = filteredMentions[activeIndex];
          if (mention) {
            insertMention(mention);
          }
          return;
        }
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.nativeEvent.isComposing
      ) {
        if (key === "b") {
          event.preventDefault();
          applyFormat("bold");
          return;
        }
        if (key === "i") {
          event.preventDefault();
          applyFormat("italic");
          return;
        }
        if (key === "u") {
          event.preventDefault();
          applyFormat("underline");
          return;
        }
        if (key === "k") {
          event.preventDefault();
          onLinkShortcut?.();
          return;
        }
      }

      if (key === "enter" && !event.nativeEvent.isComposing) {
        const action = resolveComposerEnterAction({
          isNarrowViewport:
            typeof window !== "undefined" && window.innerWidth < 768,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          isMentionKeyboardActive,
        });

        if (action === "ignore") return;

        event.preventDefault();
        if (isOpen) closeSuggestions();

        if (action === "submit") {
          onSubmitShortcut?.();
          return;
        }

        if (editorRef.current) {
          insertLineBreak(editorRef.current);
          handleInput();
        }
      }
    },
    [
      activeIndex,
      applyFormat,
      closeSuggestions,
      filteredMentions,
      getCurrentTriggerAtCaret,
      handleInput,
      insertMention,
      isOpen,
      onLinkShortcut,
      onSubmitShortcut,
    ],
  );

  const handleBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => {
      if (!isSelectingRef.current) {
        closeSuggestions();
      }
      isSelectingRef.current = false;
      publishActiveFormats();
    }, 150);
  }, [closeSuggestions, publishActiveFormats]);

  useEffect(() => {
    const onSelectionChange = () => {
      publishActiveFormats();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [publishActiveFormats]);

  useEffect(() => {
    if (!onActiveFormatsChange) return;
    publishActiveFormats();
  }, [onActiveFormatsChange, publishActiveFormats]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeItem = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Capture-phase listener: contentEditable arrow keys are more reliable
    // here than React's delegated onKeyDown alone.
    function onNativeKeyDown(event: KeyboardEvent) {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const exited = tryExitComposerInlineFormatOnArrow(
        currentEditor,
        event.key === "ArrowLeft" ? "left" : "right",
      );
      if (!exited) return;

      event.preventDefault();
      event.stopPropagation();
      handleInput();
      requestAnimationFrame(() => {
        publishActiveFormats();
      });
    }

    editor.addEventListener("keydown", onNativeKeyDown, true);
    return () => {
      editor.removeEventListener("keydown", onNativeKeyDown, true);
    };
  }, [handleInput, publishActiveFormats]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      insertText,
      openMentions,
      applyFormat,
      insertLink,
      getSelectedPlainText: () => window.getSelection()?.toString() ?? "",
    }),
    [applyFormat, insertLink, insertText, openMentions],
  );

  return (
    <>
      <div
        ref={editorRef}
        id={id}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={syncMentionSuggestionsWithCaret}
        onMouseUp={syncMentionSuggestionsWithCaret}
        onBlur={handleBlur}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        className={cn(
          "outline-none focus:outline-none",
          "wrap-anywhere [word-break:break-word] whitespace-pre-wrap",
          "empty:before:text-muted-foreground empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]",
          EDITOR_PROSE_CLASSNAME,
          className,
        )}
      />
      {typeof window !== "undefined" &&
        isOpen &&
        filteredMentions.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={
              triggerPosition
                ? { top: triggerPosition.top, left: triggerPosition.left }
                : { top: VIEWPORT_PADDING_PX, left: VIEWPORT_PADDING_PX }
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
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={() => {
                  isSelectingRef.current = true;
                }}
                onClick={() => {
                  insertMention(mention);
                  isSelectingRef.current = false;
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {renderMentionItem ? (
                  renderMentionItem(mention, index === activeIndex)
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
    </>
  );
}
