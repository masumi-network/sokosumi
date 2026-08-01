import { placeComposerCaretAfterMark } from "@/lib/utils/composer-wysiwyg-arrow-exit";

export type ComposerInputRuleFormat = "italic" | "bold" | "strike" | "code";

export interface ComposerInputRuleMatch {
  format: ComposerInputRuleFormat;
  /** Start index of the opening delimiter within `textBeforeCaret`. */
  matchStart: number;
  /** End index (exclusive); equals `textBeforeCaret.length`. */
  matchEnd: number;
  inner: string;
  openDelimiter: string;
  closeDelimiter: string;
  htmlTag: "em" | "strong" | "s" | "code";
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return WORD_CHAR.test(char);
}

function matchPairedDelimiter(
  textBeforeCaret: string,
  delimiter: string,
  format: ComposerInputRuleFormat,
  htmlTag: ComposerInputRuleMatch["htmlTag"],
): ComposerInputRuleMatch | null {
  if (!textBeforeCaret.endsWith(delimiter)) return null;

  const closeStart = textBeforeCaret.length - delimiter.length;
  const before = textBeforeCaret.slice(0, closeStart);
  const openIndex = before.lastIndexOf(delimiter);
  if (openIndex < 0) return null;

  const inner = before.slice(openIndex + delimiter.length);
  if (inner.length === 0) return null;
  if (inner.includes("\n")) return null;
  if (delimiter === "`" && inner.includes("`")) return null;
  if (delimiter === "_" && (inner.includes("_") || inner.includes("*"))) {
    return null;
  }
  if (delimiter === "**" && inner.includes("**")) return null;
  if (delimiter === "~~" && inner.includes("~~")) return null;

  const charBeforeOpen = openIndex > 0 ? before[openIndex - 1] : undefined;
  if (isWordChar(charBeforeOpen)) return null;

  return {
    format,
    matchStart: openIndex,
    matchEnd: textBeforeCaret.length,
    inner,
    openDelimiter: delimiter,
    closeDelimiter: delimiter,
    htmlTag,
  };
}

/**
 * Detect Slack-style closing delimiter at end of `textBeforeCaret`.
 * Prefer longer delimiters (`**`, `~~`) before `_` / `` ` ``.
 */
export function matchComposerInputRule(
  textBeforeCaret: string,
): ComposerInputRuleMatch | null {
  if (!textBeforeCaret) return null;

  return (
    matchPairedDelimiter(textBeforeCaret, "**", "bold", "strong") ??
    matchPairedDelimiter(textBeforeCaret, "~~", "strike", "s") ??
    matchPairedDelimiter(textBeforeCaret, "_", "italic", "em") ??
    matchPairedDelimiter(textBeforeCaret, "`", "code", "code")
  );
}

export type ComposerEnterAction = "submit" | "newline" | "ignore";

/**
 * Room composer Enter policy (inverted vs tasks MarkdownEditor):
 * desktop Enter → send; Shift/Cmd/Ctrl+Enter → newline; mobile Enter → newline.
 */
export function resolveComposerEnterAction(options: {
  isNarrowViewport: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isMentionKeyboardActive: boolean;
}): ComposerEnterAction {
  if (options.isMentionKeyboardActive) return "ignore";
  if (options.shiftKey || options.metaKey || options.ctrlKey) {
    return "newline";
  }
  if (options.isNarrowViewport) return "newline";
  return "submit";
}

const PROTECTED_TAGS = new Set(["CODE", "PRE"]);

function isInsideComposerProtectedContext(
  node: Node | null,
  root: HTMLElement,
): boolean {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      if (PROTECTED_TAGS.has(current.tagName)) return true;
      if (current.dataset.mentionKey) return true;
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Apply a matched input rule inside a text node ending at `caretOffset`.
 */
function applyComposerInputRuleToTextNode(
  textNode: Text,
  caretOffset: number,
  match: ComposerInputRuleMatch,
): boolean {
  const fullText = textNode.textContent ?? "";
  if (caretOffset < match.matchEnd) return false;
  const prefixLength = caretOffset - match.matchEnd;
  const absoluteStart = prefixLength + match.matchStart;
  const absoluteEnd = prefixLength + match.matchEnd;
  if (absoluteStart < 0 || absoluteEnd > fullText.length) return false;

  const before = fullText.slice(0, absoluteStart);
  const after = fullText.slice(absoluteEnd);

  const formatted = document.createElement(match.htmlTag);
  formatted.textContent = match.inner;

  const parent = textNode.parentNode;
  if (!parent) return false;

  const beforeNode = document.createTextNode(before);
  parent.insertBefore(beforeNode, textNode);
  parent.insertBefore(formatted, textNode);

  if (after) {
    parent.insertBefore(document.createTextNode(after), textNode);
  }
  parent.removeChild(textNode);

  // Exit pad (not an empty text node) so Chromium does not snap the caret
  // back into the mark on the next keystroke — critical for <code> chips.
  placeComposerCaretAfterMark(formatted);

  return true;
}

/**
 * Try converting a just-typed closing delimiter at the caret into live format.
 */
export function tryApplyComposerInputRuleAtCaret(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  if (isInsideComposerProtectedContext(range.startContainer, root)) {
    return false;
  }

  if (range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer as Text;
  const caretOffset = range.startOffset;
  const textBeforeCaret = (textNode.textContent ?? "").slice(0, caretOffset);
  const match = matchComposerInputRule(textBeforeCaret);
  if (!match) return false;

  return applyComposerInputRuleToTextNode(textNode, caretOffset, match);
}
