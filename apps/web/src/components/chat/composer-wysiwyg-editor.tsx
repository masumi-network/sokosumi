"use client";

import type { ClipboardEvent, ReactNode, Ref } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";

import {
  type ComposerSuggestion,
  resolveComposerSuggestion,
} from "@/components/chat/composer-suggestions";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";
import {
  createMentionSpan,
  deslugifyMentionSlug,
  filterNormalizedMentions,
  findPositionForOffset,
  getActiveEmojiTrigger,
  getActiveTrigger,
  getCaretOffset,
  getCaretRect,
  getMentionPopupPositionFromAnchorRect,
  getPopupPositionFromRect,
  getSuggestionPopupFixedStyle,
  isWhitespaceChar,
  MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX,
  MENTION_CLASSNAME,
  type MentionRecordEntry,
  type MentionSuggestionGroup,
  type NormalizedMention,
  serializeEditor,
  serializeEditorText,
  setCaretAfterNode,
  shouldAppendTrailingSpace,
  type TriggerPosition,
  UNKNOWN_MENTION_CLASSNAME,
  VIEWPORT_PADDING_PX,
} from "@/components/ui/mention-textarea-utils";
import { cn } from "@/lib/utils";
import {
  type ComposerActiveFormats,
  type ComposerFormatCommand,
  getComposerActiveFormats,
} from "@/lib/utils/composer-active-formats";
import { matchEmoticonClosedAtBoundary } from "@/lib/utils/composer-emoticons";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "@/lib/utils/composer-markdown-dom";
import {
  composerPastedHtmlToPlainText,
  stripComposerInlineTextColors,
} from "@/lib/utils/composer-paste-sanitize";
import { tryExitComposerInlineFormatOnArrow } from "@/lib/utils/composer-wysiwyg-arrow-exit";
import { toggleComposerInlineCode } from "@/lib/utils/composer-wysiwyg-code-format";
import { replaceComposerTextRange } from "@/lib/utils/composer-wysiwyg-dom";
import {
  resolveComposerEnterAction,
  tryApplyComposerInputRuleAtCaret,
} from "@/lib/utils/composer-wysiwyg-input-rules";
import {
  type EmojiShortcodeMatch,
  matchExactEmojiShortcodeClosed,
} from "@/lib/utils/emoji-shortcodes";
import { normalizeUrl } from "@/lib/utils/markdown-editor-utils";
import { parseMentions, slugifyMentionValue } from "@/lib/utils/mention-parser";

type SuggestionUiState =
  | { open: false }
  | {
      open: true;
      suggestion: ComposerSuggestion;
      position: TriggerPosition;
      activeIndex: number;
    };

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
  /** When set, mention popup renders section headers; keyboard uses flat items only. */
  groupMentions?: (
    filtered: NormalizedMention<TData>[],
  ) => MentionSuggestionGroup<TData>[];
}

const EDITOR_PROSE_CLASSNAME = cn(
  "markdown-compose-surface",
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

function restoreCaretAtOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const position = findPositionForOffset(root, offset);
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  groupMentions,
}: ComposerWysiwygEditorProps<TData>) {
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const isInternalChange = useRef(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualMentionOpenRef = useRef(false);
  const savedCaretOffsetRef = useRef<number | null>(null);
  const onActiveFormatsChangeRef = useRef(onActiveFormatsChange);
  onActiveFormatsChangeRef.current = onActiveFormatsChange;
  const [suggestionUi, setSuggestionUi] = useState<SuggestionUiState>({
    open: false,
  });

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

  const mentionQuery =
    suggestionUi.open && suggestionUi.suggestion.kind === "mention"
      ? suggestionUi.suggestion.query
      : null;

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    return filterNormalizedMentions(normalizedMentions, mentionQuery);
  }, [mentionQuery, normalizedMentions]);

  const mentionGroups = useMemo(() => {
    if (!groupMentions || mentionQuery === null) return null;
    return groupMentions(filteredMentions);
  }, [filteredMentions, groupMentions, mentionQuery]);

  const selectableMentions = useMemo(() => {
    if (mentionGroups) {
      return mentionGroups.flatMap((group) => group.items);
    }
    return filteredMentions;
  }, [filteredMentions, mentionGroups]);

  const emojiMatches =
    suggestionUi.open && suggestionUi.suggestion.kind === "emoji"
      ? suggestionUi.suggestion.matches
      : [];

  const activeIndex = suggestionUi.open ? suggestionUi.activeIndex : 0;
  const triggerPosition = suggestionUi.open ? suggestionUi.position : null;
  const suggestionKind = suggestionUi.open
    ? suggestionUi.suggestion.kind
    : null;
  const isOpen = suggestionUi.open;
  const visibleSuggestionCount =
    suggestionKind === "emoji"
      ? emojiMatches.length
      : selectableMentions.length;

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
      suggestion,
      nextTriggerPosition,
      nextActiveIndex = 0,
    }: {
      suggestion: ComposerSuggestion;
      nextTriggerPosition: TriggerPosition;
      nextActiveIndex?: number;
    }) => {
      setSuggestionUi({
        open: true,
        suggestion,
        position: nextTriggerPosition,
        activeIndex: nextActiveIndex,
      });
    },
    [],
  );

  const closeSuggestions = useCallback(() => {
    setSuggestionUi({ open: false });
    manualMentionOpenRef.current = false;
  }, []);

  const getSuggestionPopupPosition = useCallback(
    (editor: HTMLElement, kind: ComposerSuggestion["kind"]) => {
      if (kind === "mention" || kind === "emoji") {
        const shell = editor.closest(`[${ROOM_COMPOSER_MENTION_ANCHOR_ATTR}]`);
        if (shell instanceof HTMLElement) {
          return getMentionPopupPositionFromAnchorRect(
            shell.getBoundingClientRect(),
          );
        }
      }
      const caretRect = getCaretRect(editor);
      const fallbackRect = editor.getBoundingClientRect();
      return caretRect
        ? getPopupPositionFromRect(caretRect)
        : getPopupPositionFromRect(fallbackRect);
    },
    [],
  );

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
    const editor = editorRef.current;
    if (!editor) {
      isInternalChange.current = false;
      return;
    }

    const isExternalClear = value.trim().length === 0;
    // Clears must win over isInternalChange: a same-turn clear after input
    // otherwise leaves stale DOM because this effect will not re-run for "".
    if (isInternalChange.current && !isExternalClear) {
      isInternalChange.current = false;
      return;
    }

    const currentHtml = editor.innerHTML;
    const newHtml = markdownToHtml(value, resolveMentionDisplay);
    const isFocused = editor.contains(document.activeElement);
    const editorLooksEmpty =
      currentHtml === "" ||
      currentHtml === "<br>" ||
      currentHtml === "<div><br></div>" ||
      currentHtml === "<p><br></p>";

    // Focused non-clear updates skip to keep the caret; still apply into an
    // empty editor (restore after failed send cleared DOM first).
    if (
      currentHtml !== newHtml &&
      (!isFocused || isExternalClear || editorLooksEmpty)
    ) {
      editor.innerHTML = newHtml || "";
    }
    isInternalChange.current = false;
  }, [value, resolveMentionDisplay]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;

    // Drop clipboard/typing colors before markdown sync; they stick in the DOM
    // while React state stays color-free until remount (hard refresh).
    stripComposerInlineTextColors(editorRef.current);
    tryApplyComposerInputRuleAtCaret(editorRef.current);

    isInternalChange.current = true;
    const { text, caret } = syncFromEditor();
    publishActiveFormats();

    const exactEmoji = matchExactEmojiShortcodeClosed(text, caret);
    if (exactEmoji) {
      const nextChar = text[exactEmoji.end];
      const insert = shouldAppendTrailingSpace(nextChar)
        ? `${exactEmoji.emoji} `
        : exactEmoji.emoji;
      if (
        replaceComposerTextRange(
          editorRef.current,
          exactEmoji.triggerStart,
          exactEmoji.end,
          insert,
        )
      ) {
        isInternalChange.current = true;
        syncFromEditor();
        closeSuggestions();
        return;
      }
    }

    // Emoticon live convert: include the closing boundary (space/punct) in the
    // replace so caret lands after it — otherwise typing glues to the emoji and
    // the user needs a second space for the next word.
    // Converts only at the caret boundary (not a full-document scan); paste of
    // multiple mid-string emoticons still converts on send via remark-emoji.
    const emoticonMatch = matchEmoticonClosedAtBoundary(text, caret);
    if (emoticonMatch && editorRef.current) {
      const boundarySuffix = text.slice(emoticonMatch.end, caret);
      const deleteEnd = emoticonMatch.end + boundarySuffix.length;
      if (
        replaceComposerTextRange(
          editorRef.current,
          emoticonMatch.start,
          deleteEnd,
          `${emoticonMatch.emoji}${boundarySuffix}`,
        )
      ) {
        // Live path: no flushSync — next keystroke/blur/submit sees state.
        // flushSync reserved for tryFlushTrailingEmoticon (same-tick submit).
        isInternalChange.current = true;
        syncFromEditor();
        closeSuggestions();
        return;
      }
    }

    if (manualMentionOpenRef.current && normalizedMentions.length > 0) {
      openSuggestions({
        suggestion: {
          kind: "mention",
          query: "",
          triggerStart: caret,
        },
        nextTriggerPosition: getSuggestionPopupPosition(
          editorRef.current,
          "mention",
        ),
        nextActiveIndex: 0,
      });
      return;
    }

    const suggestion = resolveComposerSuggestion(text, caret, {
      mentionsAvailable: normalizedMentions.length > 0,
    });

    if (suggestion) {
      openSuggestions({
        suggestion,
        nextTriggerPosition: getSuggestionPopupPosition(
          editorRef.current,
          suggestion.kind,
        ),
        nextActiveIndex: 0,
      });
      return;
    }

    closeSuggestions();
  }, [
    closeSuggestions,
    getSuggestionPopupPosition,
    normalizedMentions.length,
    openSuggestions,
    publishActiveFormats,
    syncFromEditor,
  ]);

  const insertMention = useCallback(
    (mention: NormalizedMention<TData>) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Listbox clicks leave the selection outside the editor. Always resolve
      // insert offsets from editor text, never from window.getSelection().
      editor.focus();
      const savedOffset = savedCaretOffsetRef.current;
      if (savedOffset != null) {
        restoreCaretAtOffset(editor, savedOffset);
      } else if (getCaretOffset(editor) == null) {
        restoreCaretAtOffset(editor, serializeEditorText(editor).length);
      }

      let { text, caret } = serializeEditor(editor);
      const trigger = getActiveTrigger(text, caret);

      let startOffset: number;
      let endOffset: number;
      if (trigger) {
        startOffset = trigger.triggerStart;
        endOffset = caret;
      } else if (manualMentionOpenRef.current) {
        if (caret > 0 && !isWhitespaceChar(text[caret - 1] ?? "")) {
          const spacePos = findPositionForOffset(editor, caret);
          const spaceRange = document.createRange();
          spaceRange.setStart(spacePos.node, spacePos.offset);
          spaceRange.collapse(true);
          spaceRange.insertNode(document.createTextNode(" "));
          restoreCaretAtOffset(editor, caret + 1);
          ({ text, caret } = serializeEditor(editor));
        }
        startOffset = caret;
        endOffset = caret;
      } else {
        closeSuggestions();
        return;
      }

      const range = document.createRange();
      const startPos = findPositionForOffset(editor, startOffset);
      const endPos = findPositionForOffset(editor, endOffset);
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      range.deleteContents();

      const nextChar = text[endOffset];
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

      setCaretAfterNode(editor, caretNode);
      const nextOffset = getCaretOffset(editor);
      savedCaretOffsetRef.current = nextOffset;
      isInternalChange.current = true;
      syncFromEditor();
      closeSuggestions();
      editor.focus();
    },
    [closeSuggestions, resolveMentionDisplay, syncFromEditor],
  );

  const insertEmojiShortcode = useCallback(
    (match: EmojiShortcodeMatch) => {
      if (!editorRef.current) return;

      const { text, caret } = serializeEditor(editorRef.current);
      const trigger = getActiveEmojiTrigger(text, caret);
      if (!trigger) {
        closeSuggestions();
        return;
      }

      const startPos = findPositionForOffset(
        editorRef.current,
        trigger.triggerStart,
      );
      const endPos = findPositionForOffset(editorRef.current, caret);
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      range.deleteContents();

      const nextChar = text[caret];
      const insert = shouldAppendTrailingSpace(nextChar)
        ? `${match.emoji} `
        : match.emoji;
      const textNode = document.createTextNode(insert);
      range.insertNode(textNode);
      setCaretAfterNode(editorRef.current, textNode);
      isInternalChange.current = true;
      syncFromEditor();
      closeSuggestions();
      editorRef.current.focus();
    },
    [closeSuggestions, syncFromEditor],
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
      const editor = editorRef.current;
      if (!editor) return;

      const offset = savedCaretOffsetRef.current;
      editor.focus();
      if (offset != null) {
        restoreCaretAtOffset(editor, offset);
      } else {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

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
        } else {
          editor.appendChild(document.createTextNode(text));
        }
      }

      const nextOffset = getCaretOffset(editor);
      savedCaretOffsetRef.current =
        nextOffset ?? (offset != null ? offset + text.length : null);

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
    // Toolbar clicks blur the editor first; cancel that close so the picker
    // does not open then immediately dismiss.
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    const hadEditorSelection = getCaretOffset(editor) != null;
    editor.focus();
    if (!hadEditorSelection) {
      const saved = savedCaretOffsetRef.current;
      restoreCaretAtOffset(editor, saved ?? serializeEditorText(editor).length);
    }
    const { caret } = serializeEditor(editor);
    savedCaretOffsetRef.current = caret;
    manualMentionOpenRef.current = true;
    openSuggestions({
      suggestion: {
        kind: "mention",
        query: "",
        triggerStart: caret,
      },
      nextTriggerPosition: getSuggestionPopupPosition(editor, "mention"),
      nextActiveIndex: 0,
    });
  }, [getSuggestionPopupPosition, openSuggestions]);

  const getLiveSuggestionAtCaret = useCallback(() => {
    if (!editorRef.current) return null;
    if (manualMentionOpenRef.current && normalizedMentions.length > 0) {
      return {
        kind: "mention" as const,
        query: "",
        triggerStart: 0,
      };
    }
    const { text, caret } = serializeEditor(editorRef.current);
    return resolveComposerSuggestion(text, caret, {
      mentionsAvailable: normalizedMentions.length > 0,
    });
  }, [normalizedMentions.length]);

  const syncSuggestionsWithCaret = useCallback(() => {
    publishActiveFormats();
    if (!suggestionUi.open || !editorRef.current) return;
    if (manualMentionOpenRef.current) return;

    const live = getLiveSuggestionAtCaret();
    if (!live || live.kind !== suggestionKind) {
      closeSuggestions();
      return;
    }

    const listLength =
      live.kind === "emoji"
        ? live.matches.length
        : filterNormalizedMentions(normalizedMentions, live.query).length;

    if (listLength === 0) {
      closeSuggestions();
      return;
    }

    openSuggestions({
      suggestion: live,
      nextTriggerPosition: getSuggestionPopupPosition(
        editorRef.current,
        live.kind,
      ),
      nextActiveIndex: Math.min(suggestionUi.activeIndex, listLength - 1),
    });
  }, [
    closeSuggestions,
    getLiveSuggestionAtCaret,
    getSuggestionPopupPosition,
    normalizedMentions,
    openSuggestions,
    publishActiveFormats,
    suggestionKind,
    suggestionUi,
  ]);

  const setActiveSuggestionIndex = useCallback(
    (updater: (prev: number) => number) => {
      setSuggestionUi((prev) => {
        if (!prev.open) return prev;
        return { ...prev, activeIndex: updater(prev.activeIndex) };
      });
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !editorRef.current || !suggestionKind) return;
    const editor = editorRef.current;

    const updatePosition = () => {
      const nextPosition = getSuggestionPopupPosition(editor, suggestionKind);
      setSuggestionUi((prev) => {
        if (!prev.open) return prev;
        return { ...prev, position: nextPosition };
      });
    };

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", updatePosition);
    visualViewport?.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);
    let nestedRafId = 0;
    const rafId = requestAnimationFrame(() => {
      nestedRafId = requestAnimationFrame(updatePosition);
    });

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(nestedRafId);
      visualViewport?.removeEventListener("resize", updatePosition);
      visualViewport?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [getSuggestionPopupPosition, isOpen, suggestionKind]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const plain = clipboard.getData("text/plain");
      const html = clipboard.getData("text/html");
      // Own any text/html paste so the browser never injects rich clipboard
      // markup. File-only pastes leave both empty and bubble to the drop zone.
      if (!plain && !html) return;

      event.preventDefault();
      // Always paste plain text — never keep rich clipboard HTML (links, bold,
      // colors). Toolbar / markdown input rules still apply after paste.
      const text = plain || (html ? composerPastedHtmlToPlainText(html) : "");
      if (!text) return;

      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();

      let didInsert = false;
      try {
        didInsert = document.execCommand("insertText", false, text);
      } catch {
        didInsert = false;
      }
      if (!didInsert) {
        const selection = window.getSelection();
        const textNode = document.createTextNode(text);
        const range =
          selection && selection.rangeCount > 0
            ? selection.getRangeAt(0)
            : null;
        const rangeInEditor =
          range && editor.contains(range.commonAncestorContainer)
            ? range
            : null;
        if (rangeInEditor && selection) {
          rangeInEditor.deleteContents();
          rangeInEditor.insertNode(textNode);
          rangeInEditor.setStartAfter(textNode);
          rangeInEditor.collapse(true);
          selection.removeAllRanges();
          selection.addRange(rangeInEditor);
        } else {
          editor.appendChild(textNode);
        }
        didInsert = true;
      }

      if (didInsert) {
        handleInput();
      }
    },
    [handleInput],
  );

  const tryFlushTrailingEmoticon = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const { text } = serializeEditor(editor);
    const match = matchEmoticonClosedAtBoundary(text, text.length, {
      flush: true,
    });
    if (!match) return;

    if (
      !replaceComposerTextRange(editor, match.start, match.end, match.emoji)
    ) {
      return;
    }
    // flushSync so parent composerValue updates before requestSubmit/onSubmit.
    flushSync(() => {
      isInternalChange.current = true;
      syncFromEditor();
    });
  }, [syncFromEditor]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      const isDropdownVisible = isOpen && visibleSuggestionCount > 0;

      // Escape always dismisses while the popup is open, even if caret left the
      // trigger (selectionchange may lag behind the key event).
      if (isOpen && !hasModifier && key === "escape") {
        event.preventDefault();
        closeSuggestions();
        return;
      }

      if (isDropdownVisible && !hasModifier) {
        if (key === "arrowdown") {
          event.preventDefault();
          setActiveSuggestionIndex((prev) =>
            prev + 1 < visibleSuggestionCount ? prev + 1 : 0,
          );
          return;
        }

        if (key === "arrowup") {
          event.preventDefault();
          setActiveSuggestionIndex((prev) =>
            prev - 1 >= 0 ? prev - 1 : visibleSuggestionCount - 1,
          );
          return;
        }

        if (key === "enter" || key === "tab") {
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (suggestionKind === "emoji") {
            const match = emojiMatches[activeIndex];
            if (match) insertEmojiShortcode(match);
          } else {
            const mention = selectableMentions[activeIndex];
            if (mention) insertMention(mention);
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
          isSuggestionKeyboardActive: isDropdownVisible,
        });

        if (action === "ignore") return;

        event.preventDefault();
        if (isOpen) closeSuggestions();

        if (action === "submit") {
          tryFlushTrailingEmoticon();
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
      emojiMatches,
      handleInput,
      insertEmojiShortcode,
      insertMention,
      isOpen,
      onLinkShortcut,
      onSubmitShortcut,
      selectableMentions,
      setActiveSuggestionIndex,
      suggestionKind,
      tryFlushTrailingEmoticon,
      visibleSuggestionCount,
    ],
  );

  const handleBlur = useCallback(() => {
    // Sync flush so Send click (blur → submit same tick) sees emoji in parent state.
    // Suggestion-close stays deferred so listbox mousedown can set isSelectingRef.
    tryFlushTrailingEmoticon();
    blurTimeoutRef.current = setTimeout(() => {
      if (!isSelectingRef.current) {
        closeSuggestions();
      }
      isSelectingRef.current = false;
      publishActiveFormats();
    }, 150);
  }, [closeSuggestions, publishActiveFormats, tryFlushTrailingEmoticon]);

  useEffect(() => {
    const onSelectionChange = () => {
      publishActiveFormats();
      const editor = editorRef.current;
      if (!editor) return;
      const caretOffset = getCaretOffset(editor);
      if (caretOffset != null) {
        savedCaretOffsetRef.current = caretOffset;
      }
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
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onKeyUp={syncSuggestionsWithCaret}
        onMouseUp={syncSuggestionsWithCaret}
        onBlur={handleBlur}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        style={{ scrollMarginTop: MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX }}
        className={cn(
          // relative: empty placeholder is absolutely positioned so long
          // channel/DM names do not grow empty-editor height (room Instant → shell).
          "relative outline-none focus:outline-none",
          "wrap-anywhere [word-break:break-word] whitespace-pre-wrap",
          "empty:before:pointer-events-none empty:before:absolute empty:before:inset-x-0 empty:before:top-0 empty:before:max-w-full empty:before:truncate empty:before:overflow-hidden empty:before:whitespace-nowrap empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
          EDITOR_PROSE_CLASSNAME,
          className,
        )}
      />
      {typeof window !== "undefined" &&
        isOpen &&
        visibleSuggestionCount > 0 &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={
              triggerPosition
                ? getSuggestionPopupFixedStyle(triggerPosition)
                : { top: VIEWPORT_PADDING_PX, left: VIEWPORT_PADDING_PX }
            }
            className={cn(
              "bg-popover text-popover-foreground fixed z-50 overflow-y-auto rounded-xl border p-1 shadow-md",
              triggerPosition?.width == null && "w-72",
              !triggerPosition && "mt-1 max-h-60",
            )}
          >
            {suggestionKind === "emoji"
              ? emojiMatches.map((match, index) => (
                  <div
                    key={match.name}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                      index === activeIndex &&
                        "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={() => {
                      isSelectingRef.current = true;
                    }}
                    onClick={() => {
                      insertEmojiShortcode(match);
                      isSelectingRef.current = false;
                    }}
                    onMouseEnter={() => setActiveSuggestionIndex(() => index)}
                  >
                    <span
                      className="size-6 shrink-0 text-center text-base leading-6"
                      aria-hidden
                    >
                      {match.emoji}
                    </span>
                    <span className="truncate">:{match.name}:</span>
                  </div>
                ))
              : mentionGroups
                ? (() => {
                    let optionIndex = 0;
                    return mentionGroups.map((group) => (
                      <div key={group.id}>
                        <div
                          role="presentation"
                          className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
                        >
                          {group.label}
                        </div>
                        {group.items.map((mention) => {
                          const index = optionIndex;
                          optionIndex += 1;
                          return (
                            <div
                              key={mention.key}
                              data-index={index}
                              role="option"
                              aria-selected={index === activeIndex}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                                index === activeIndex &&
                                  "bg-accent text-accent-foreground",
                              )}
                              onMouseDown={() => {
                                isSelectingRef.current = true;
                              }}
                              onClick={() => {
                                insertMention(mention);
                                isSelectingRef.current = false;
                              }}
                              onMouseEnter={() =>
                                setActiveSuggestionIndex(() => index)
                              }
                            >
                              {renderMentionItem ? (
                                renderMentionItem(
                                  mention,
                                  index === activeIndex,
                                )
                              ) : (
                                <>
                                  <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                    {mention.value.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="truncate">
                                    {mention.value}
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()
                : selectableMentions.map((mention, index) => (
                    <div
                      key={mention.key}
                      data-index={index}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                        index === activeIndex &&
                          "bg-accent text-accent-foreground",
                      )}
                      onMouseDown={() => {
                        isSelectingRef.current = true;
                      }}
                      onClick={() => {
                        insertMention(mention);
                        isSelectingRef.current = false;
                      }}
                      onMouseEnter={() => setActiveSuggestionIndex(() => index)}
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
