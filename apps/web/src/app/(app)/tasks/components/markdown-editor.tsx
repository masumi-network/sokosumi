"use client";

import {
  escapeMarkdownLinkUrl,
  replaceMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
} from "lucide-react";
import type { ReactNode } from "react";
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

import { Button } from "@/components/ui/button";
import {
  createMentionSpan,
  deslugifyMentionSlug,
  findPositionForOffset,
  getActiveTrigger,
  getCaretRect,
  getMentionToken,
  getPopupPositionFromRect,
  isMentionSpan,
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
  getBacktickFence,
  isBlockMarkdownElement,
  normalizeUrl,
} from "@/lib/utils/markdown-editor-utils";
import { parseMentions, slugifyMentionValue } from "@/lib/utils/mention-parser";

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmitShortcut?: () => void;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  style?: React.CSSProperties;
  onAttachClick?: () => void;
  attachLabel?: string;
  isAttachmentUploading?: boolean;
  mentions?: Record<string, MentionRecordEntry>;
  renderMentionItem?: (
    mention: NormalizedMention,
    isActive: boolean,
  ) => ReactNode;
}

export interface MarkdownEditorHandle {
  insertText: (text: string) => void;
  insertLink: (label: string, url: string) => void;
}

const PERSISTED_INTERNAL_MENTION_REGEX = /@@MENTION_?(\d+)@@/g;

function normalizePersistedInternalMentions(text: string): string {
  return text.replace(
    PERSISTED_INTERNAL_MENTION_REGEX,
    (_match, mentionIndex: string) =>
      `@unknown-mention-${mentionIndex}:unknown-mention-${mentionIndex}`,
  );
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    id,
    value,
    onChange,
    onSubmitShortcut,
    placeholder = "Enter details...",
    className,
    editorClassName,
    style,
    onAttachClick,
    attachLabel,
    isAttachmentUploading = false,
    mentions = {},
    renderMentionItem,
  }: MarkdownEditorProps,
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const isInternalChange = useRef(false);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] =
    useState<TriggerPosition | null>(null);

  const normalizedMentions = useMemo(() => {
    const entries = Object.entries(mentions);
    const normalized: NormalizedMention[] = [];

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
  }, []);

  // Convert markdown to HTML (only on initial load or external value changes)
  const markdownToHtml = useCallback(
    (text: string): string => {
      if (!text) return "";

      const escaped = normalizePersistedInternalMentions(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // Extract fenced code blocks before other markdown transforms, so inline
      // patterns don't accidentally rewrite code content.
      const codeBlocks: Array<{
        token: string;
        html: string;
      }> = [];

      const withCodeBlockTokens = escaped.replace(
        /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g,
        (
          _match,
          leadingNewline: string,
          fence: string,
          info: string,
          code: string,
        ) => {
          const token = `@@CODEBLOCKTOKEN${codeBlocks.length}@@`;
          const language = info.trim();
          const html = `<pre><code${
            language ? ` data-language="${language}"` : ""
          }>${code}</code></pre>`;

          codeBlocks.push({ token, html });
          return `${leadingNewline}${token}`;
        },
      );

      const linkTokens: Array<{
        token: string;
        html: string;
      }> = [];

      const withLinkTokens = replaceMarkdownLinks(
        withCodeBlockTokens,
        ({ match, text: label, rawUrl }) => {
          const normalizedUrl = normalizeUrl(unescapeMarkdownLinkUrl(rawUrl));
          if (!normalizedUrl) {
            return match;
          }

          const token = `@@LINKTOKEN${linkTokens.length}@@`;
          linkTokens.push({
            token,
            html: `<a href="${normalizedUrl}">${label}</a>`,
          });
          return token;
        },
      );

      const mentionTokens: Array<{
        token: string;
        html: string;
      }> = [];

      let withMentionTokens = withLinkTokens;
      const parsedMentions = parseMentions(withLinkTokens);
      if (parsedMentions.length > 0) {
        let lastIndex = 0;
        let rebuilt = "";

        for (const mention of parsedMentions) {
          if (mention.start > lastIndex) {
            rebuilt += withLinkTokens.slice(lastIndex, mention.start);
          }

          const rawMentionToken = withLinkTokens.slice(
            mention.start,
            mention.end,
          );
          if (rawMentionToken.startsWith("@@")) {
            rebuilt += rawMentionToken;
            lastIndex = mention.end;
            continue;
          }

          const token = `@@MENTIONTOKEN${mentionTokens.length}@@`;
          const { displayName, isKnown } = resolveMentionDisplay(
            mention.id,
            mention.slug,
          );
          const mentionSpan = createMentionSpan(
            mention.id,
            mention.slug,
            displayName,
            isKnown,
            {
              mentionClassName: MENTION_CLASSNAME,
              unknownMentionClassName: UNKNOWN_MENTION_CLASSNAME,
            },
          );
          mentionTokens.push({
            token,
            html: mentionSpan.outerHTML,
          });
          rebuilt += token;
          lastIndex = mention.end;
        }

        if (lastIndex < withLinkTokens.length) {
          rebuilt += withLinkTokens.slice(lastIndex);
        }

        withMentionTokens = rebuilt;
      }

      const html = withMentionTokens
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/^[-*] (.+)$/gm, "<ul><li>$1</li></ul>")
        .replace(/^(\d+)\. (.+)$/gm, "<ol><li>$2</li></ol>")
        .replace(/\n/g, "<br>");

      const withRestoredMentions = mentionTokens.reduce((result, mention) => {
        return result.replace(mention.token, () => mention.html);
      }, html);

      const withRestoredLinks = linkTokens.reduce((result, link) => {
        return result.replace(link.token, () => link.html);
      }, withRestoredMentions);

      return codeBlocks.reduce((result, block) => {
        return result.replace(block.token, () => block.html);
      }, withRestoredLinks);
    },
    [resolveMentionDisplay],
  );

  // Convert HTML to markdown (on every change)
  const htmlToMarkdown = useCallback((element: HTMLElement): string => {
    let result = "";

    function getCodeContent(codeContainer: HTMLElement): string {
      const text = codeContainer.innerText ?? codeContainer.textContent ?? "";
      return text.replace(/\r/g, "");
    }

    function getCodeLanguage(codeElement: HTMLElement): string {
      const dataLanguage = codeElement.dataset.language?.trim() ?? "";
      if (dataLanguage) return dataLanguage;

      const classLanguage =
        codeElement.className
          .split(/\s+/)
          .find((className) => className.startsWith("language-"))
          ?.replace("language-", "")
          .trim() ?? "";

      return classLanguage;
    }

    function serializeFencedCode(
      codeContent: string,
      language: string | undefined,
    ): string {
      const fence = getBacktickFence(codeContent);
      const infoString = language?.trim();
      const fenceHeader = infoString ? `${fence}${infoString}` : fence;
      return `${fenceHeader}\n${codeContent}\n${fence}\n`;
    }

    function appendChildMarkdown(
      acc: string,
      child: Node,
      childMarkdown: string,
    ): string {
      if (!childMarkdown) return acc;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        return acc + childMarkdown;
      }

      const childElement = child as HTMLElement;
      const childTag = childElement.tagName.toLowerCase();
      const shouldSeparateAsBlock = isBlockMarkdownElement(
        childTag,
        childMarkdown,
      );

      if (shouldSeparateAsBlock && acc.length > 0 && !acc.endsWith("\n")) {
        return `${acc}\n${childMarkdown}`;
      }

      return acc + childMarkdown;
    }

    const processNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        if (isMentionSpan(el)) {
          return getMentionToken(
            el.dataset.mentionKey ?? "",
            el.dataset.mentionSlug ?? "",
          );
        }

        const element = el as HTMLElement;

        if (tag === "pre") {
          const codeElement = element.querySelector("code");
          const content = getCodeContent(codeElement ?? element);
          const language = codeElement
            ? getCodeLanguage(codeElement)
            : undefined;
          return serializeFencedCode(content, language);
        }

        let content = "";

        element.childNodes.forEach((child: Node) => {
          const childMarkdown = processNode(child);
          content = appendChildMarkdown(content, child, childMarkdown);
        });

        switch (tag) {
          case "strong":
          case "b":
            return `**${content}**`;
          case "em":
          case "i":
            return `_${content}_`;
          case "code": {
            if (content.includes("\n")) {
              return serializeFencedCode(content, getCodeLanguage(element));
            }
            return `\`${content}\``;
          }
          case "a":
            return `[${content}](${escapeMarkdownLinkUrl(
              element.getAttribute("href") || "",
            )})`;
          case "h1":
            return `# ${content}\n`;
          case "h2":
            return `## ${content}\n`;
          case "h3":
            return `### ${content}\n`;
          case "li":
            return `- ${content}\n`;
          case "ul": {
            const items = Array.from(element.children).filter(
              (child) => child.tagName.toLowerCase() === "li",
            );
            return items
              .map((child) => {
                let itemContent = "";
                child.childNodes.forEach((grandchild: Node) => {
                  itemContent += processNode(grandchild);
                });
                return `- ${itemContent.trim()}`;
              })
              .join("\n")
              .concat("\n");
          }
          case "ol": {
            const items = Array.from(element.children).filter(
              (child) => child.tagName.toLowerCase() === "li",
            );
            return items
              .map((child, index) => {
                let itemContent = "";
                child.childNodes.forEach((grandchild: Node) => {
                  itemContent += processNode(grandchild);
                });
                return `${index + 1}. ${itemContent.trim()}`;
              })
              .join("\n")
              .concat("\n");
          }
          case "br":
            return "\n";
          case "div":
          case "p":
          case "blockquote":
            return content.endsWith("\n") ? content : `${content}\n`;
          default:
            return content;
        }
      }

      return "";
    };

    element.childNodes.forEach((node) => {
      const nodeMarkdown = processNode(node);
      result = appendChildMarkdown(result, node, nodeMarkdown);
    });

    const normalized = result.replace(/\r/g, "");
    if (normalized.trim().length === 0) {
      return "";
    }

    return normalized;
  }, []);

  const syncFromEditor = useCallback(() => {
    if (!editorRef.current) {
      return {
        markdown: "",
        text: "",
        caret: 0,
      };
    }

    const markdown = htmlToMarkdown(editorRef.current);
    const { text, caret } = serializeEditor(editorRef.current);
    onChange(markdown);

    return { markdown, text, caret };
  }, [htmlToMarkdown, onChange]);

  // Initialize editor content from value prop
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      const currentHtml = editorRef.current.innerHTML;
      const newHtml = markdownToHtml(value);
      const isFocused = editorRef.current.contains(document.activeElement);
      const isExternalClear = value.trim().length === 0;

      // Only update if content actually changed (avoid cursor jumping)
      if (currentHtml !== newHtml && (!isFocused || isExternalClear)) {
        editorRef.current.innerHTML = newHtml || "";
      }
    }
    isInternalChange.current = false;
  }, [value, markdownToHtml]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      const { text, caret } = syncFromEditor();

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
    }
  }, [
    closeSuggestions,
    normalizedMentions.length,
    openSuggestions,
    syncFromEditor,
  ]);

  const insertMention = useCallback(
    (mention: NormalizedMention) => {
      if (!editorRef.current) {
        return;
      }

      const { text, caret } = serializeEditor(editorRef.current);
      const trigger = getActiveTrigger(text, caret);
      if (!trigger) {
        closeSuggestions();
        return;
      }

      const range = document.createRange();
      const startPos = findPositionForOffset(
        editorRef.current,
        trigger.triggerStart,
      );
      const endPos = findPositionForOffset(editorRef.current, caret);
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      range.deleteContents();

      const nextChar = text[caret];
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
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      handleInput();
    },
    [handleInput],
  );

  const insertText = useCallback(
    (text: string) => {
      editorRef.current?.focus();
      let didInsert = false;
      try {
        didInsert = document.execCommand("insertText", false, text);
      } catch (_error) {
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
      } catch (_error) {
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
      editorRef.current?.focus();
      const safeLabel = label.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeUrl = url.replace(/"/g, "&quot;");
      const anchorHtml = `<a href="${safeUrl}">${safeLabel}</a>`;

      let didInsert = false;
      try {
        didInsert = document.execCommand("insertHTML", false, anchorHtml);
      } catch (_error) {
        didInsert = false;
      }

      if (!didInsert) {
        insertHtml(anchorHtml);
        return;
      }

      handleInput();
    },
    [handleInput, insertHtml],
  );

  const handleBold = useCallback(() => execCommand("bold"), [execCommand]);
  const handleItalic = useCallback(() => execCommand("italic"), [execCommand]);
  const handleCode = () => {
    const text = window.getSelection()?.toString() ?? "";
    const escapedText = (text || "code")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    if (text.includes("\n")) {
      insertHtml(`<pre><code>${escapedText}</code></pre>`);
      return;
    }
    insertHtml(`<code>${escapedText}</code>`);
  };
  const handleLink = () => {
    const url = prompt("Enter URL:");
    if (!url) {
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return;
    }

    const selectedText = window.getSelection()?.toString() ?? "";
    if (selectedText.trim().length > 0) {
      execCommand("createLink", normalizedUrl);
      return;
    }

    insertLink("link", normalizedUrl);
  };
  const handleHeading = () => {
    execCommand("formatBlock", "h2");
  };
  const handleBulletList = () => {
    execCommand("insertUnorderedList");
  };
  const handleNumberedList = () => {
    execCommand("insertOrderedList");
  };

  const getCurrentTriggerAtCaret = useCallback(() => {
    if (!editorRef.current) return null;
    const { text, caret } = serializeEditor(editorRef.current);
    return getActiveTrigger(text, caret);
  }, []);

  const syncMentionSuggestionsWithCaret = useCallback(() => {
    if (!isOpen) return;
    const trigger = getCurrentTriggerAtCaret();
    if (!trigger) {
      closeSuggestions();
    }
  }, [closeSuggestions, getCurrentTriggerAtCaret, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
      const currentTrigger = getCurrentTriggerAtCaret();
      const isMentionDropdownVisible = isOpen && filteredMentions.length > 0;
      const isCaretOnMentionTrigger = Boolean(currentTrigger);
      const isMentionKeyboardActive =
        isMentionDropdownVisible && isCaretOnMentionTrigger;

      if (isMentionKeyboardActive && !hasModifier) {
        if (key === "escape") {
          e.preventDefault();
          closeSuggestions();
          return;
        }

        if (key === "arrowdown") {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev + 1 < filteredMentions.length ? prev + 1 : 0,
          );
          return;
        }

        if (key === "arrowup") {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev - 1 >= 0 ? prev - 1 : filteredMentions.length - 1,
          );
          return;
        }

        if (key === "enter" || key === "tab") {
          e.preventDefault();
          const mention = filteredMentions[activeIndex];
          if (mention) {
            insertMention(mention);
          }
          return;
        }
      }

      // Plain Enter uses native contentEditable behavior. If suggestions are
      // stale, close them but do not block the browser's newline insertion.
      if (
        key === "enter" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isMentionKeyboardActive
      ) {
        if (isOpen) {
          closeSuggestions();
        }
      }

      // Cmd/Ctrl + Enter to submit parent form when provided.
      if ((e.metaKey || e.ctrlKey) && key === "enter") {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          onSubmitShortcut?.();
          return;
        }
      }

      // Cmd/Ctrl + B for bold
      if ((e.metaKey || e.ctrlKey) && key === "b") {
        e.preventDefault();
        handleBold();
        return;
      }

      // Cmd/Ctrl + I for italic
      if ((e.metaKey || e.ctrlKey) && key === "i") {
        e.preventDefault();
        handleItalic();
      }
    },
    [
      activeIndex,
      closeSuggestions,
      filteredMentions,
      getCurrentTriggerAtCaret,
      handleBold,
      handleItalic,
      insertMention,
      isOpen,
      onSubmitShortcut,
    ],
  );

  const handleBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => {
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
    (mention: NormalizedMention) => {
      insertMention(mention);
      isSelectingRef.current = false;
    },
    [insertMention],
  );

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeItem = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

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
      insertText,
      insertLink,
    }),
    [insertText, insertLink],
  );

  return (
    <div className={cn("rounded-md border", className)} style={style}>
      {/* Toolbar */}
      <div className="bg-muted/30 flex items-center gap-0.5 border-b px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleBold}
          title="Bold (Cmd+B)"
        >
          <Bold className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleItalic}
          title="Italic (Cmd+I)"
        >
          <Italic className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleCode}
          title="Code"
        >
          <Code className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleLink}
          title="Link"
        >
          <Link2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleHeading}
          title="Heading"
        >
          <Heading2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleBulletList}
          title="Bullet List"
        >
          <List className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleNumberedList}
          title="Numbered List"
        >
          <ListOrdered className="size-3.5" />
        </Button>
        {onAttachClick ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onAttachClick}
            title={attachLabel}
            aria-label={attachLabel}
          >
            <Paperclip className="size-3.5" />
          </Button>
        ) : null}
        {isAttachmentUploading ? (
          <div className="ml-auto inline-flex items-center pr-1">
            <Loader2
              className="text-muted-foreground size-3.5 animate-spin"
              aria-hidden
            />
          </div>
        ) : null}
      </div>

      {/* Single editable area */}
      <div
        ref={editorRef}
        id={id}
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={syncMentionSuggestionsWithCaret}
        onMouseUp={syncMentionSuggestionsWithCaret}
        onBlur={handleBlur}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        className={cn(
          "max-h-48 min-h-32 overflow-x-hidden overflow-y-auto px-3 py-2 text-sm",
          "outline-none focus:outline-none",
          "wrap-anywhere [word-break:break-word] whitespace-pre-wrap",
          "empty:before:text-muted-foreground empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]",
          "[&_em]:italic [&_strong]:font-bold",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
          "[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_pre]:whitespace-pre",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
          "[&_a]:text-primary [&_a]:underline",
          "[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-bold",
          "[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold",
          "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
          "[&_li]:ml-4 [&_ol>li]:list-decimal [&_ul>li]:list-disc",
          "[&_span[data-mention-key]]:text-primary [&_span[data-mention-key]]:cursor-pointer [&_span[data-mention-key]]:font-semibold [&_span[data-mention-key]]:hover:underline",
          editorClassName,
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
                onMouseDown={handleItemMouseDown}
                onClick={() => handleItemClick(mention)}
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
    </div>
  );
});
