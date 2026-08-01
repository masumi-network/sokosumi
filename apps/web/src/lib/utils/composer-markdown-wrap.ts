import {
  formatMarkdownLink,
  getBacktickFence,
  normalizeUrl,
} from "@/lib/utils/markdown-editor-utils";

export interface TextSelectionResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export type ComposerFormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "codeBlock"
  | "quote"
  | "bulletList"
  | "numberedList";

function clampRange(
  value: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  return { start: safeStart, end: safeEnd };
}

/**
 * Wrap (or unwrap) an inline marker pair around the selection.
 * Empty selection inserts markers with the caret between them.
 */
export function wrapInline(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string = open,
): TextSelectionResult {
  const range = clampRange(value, start, end);
  const selected = value.slice(range.start, range.end);

  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      text: value.slice(0, range.start) + inner + value.slice(range.end),
      selectionStart: range.start,
      selectionEnd: range.start + inner.length,
    };
  }

  if (
    range.start >= open.length &&
    value.slice(range.start - open.length, range.start) === open &&
    value.slice(range.end, range.end + close.length) === close
  ) {
    return {
      text:
        value.slice(0, range.start - open.length) +
        selected +
        value.slice(range.end + close.length),
      selectionStart: range.start - open.length,
      selectionEnd: range.start - open.length + selected.length,
    };
  }

  const next =
    value.slice(0, range.start) +
    open +
    selected +
    close +
    value.slice(range.end);
  if (selected.length === 0) {
    const caret = range.start + open.length;
    return { text: next, selectionStart: caret, selectionEnd: caret };
  }

  return {
    text: next,
    selectionStart: range.start + open.length,
    selectionEnd: range.start + open.length + selected.length,
  };
}

function expandToLineBounds(
  value: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const range = clampRange(value, start, end);
  let lineStart = range.start;
  while (lineStart > 0 && value[lineStart - 1] !== "\n") {
    lineStart -= 1;
  }
  let lineEnd = range.end;
  while (lineEnd < value.length && value[lineEnd] !== "\n") {
    lineEnd += 1;
  }
  return { start: lineStart, end: lineEnd };
}

/**
 * Prefix each selected line (or remove the prefix when every line already has it).
 */
export function wrapLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): TextSelectionResult {
  const bounds = expandToLineBounds(value, start, end);
  const block = value.slice(bounds.start, bounds.end);
  const lines = block.length === 0 ? [""] : block.split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));

  const nextLines = allPrefixed
    ? lines.map((line) => line.slice(prefix.length))
    : lines.map((line) => `${prefix}${line}`);
  const nextBlock = nextLines.join("\n");

  return {
    text: value.slice(0, bounds.start) + nextBlock + value.slice(bounds.end),
    selectionStart: bounds.start,
    selectionEnd: bounds.start + nextBlock.length,
  };
}

export function wrapCodeBlock(
  value: string,
  start: number,
  end: number,
): TextSelectionResult {
  const range = clampRange(value, start, end);
  const selected = value.slice(range.start, range.end);
  const fence = getBacktickFence(selected);
  const inner = selected.length > 0 ? selected : "";
  const block = `${fence}\n${inner}\n${fence}`;
  const next = value.slice(0, range.start) + block + value.slice(range.end);

  if (inner.length === 0) {
    const caret = range.start + fence.length + 1;
    return { text: next, selectionStart: caret, selectionEnd: caret };
  }

  return {
    text: next,
    selectionStart: range.start + fence.length + 1,
    selectionEnd: range.start + fence.length + 1 + inner.length,
  };
}

/** Build `[text](url)` via shared URL normalization; null when URL is invalid. */
export function buildMarkdownLink(text: string, url: string): string | null {
  return formatMarkdownLink(text, url);
}

export { normalizeUrl };

export function applyComposerFormat(
  value: string,
  start: number,
  end: number,
  command: ComposerFormatCommand,
): TextSelectionResult {
  switch (command) {
    case "bold":
      return wrapInline(value, start, end, "**");
    case "italic":
      return wrapInline(value, start, end, "_");
    case "underline":
      return wrapInline(value, start, end, "<u>", "</u>");
    case "strikethrough":
      return wrapInline(value, start, end, "~~");
    case "code":
      return wrapInline(value, start, end, "`");
    case "codeBlock":
      return wrapCodeBlock(value, start, end);
    case "quote":
      return wrapLines(value, start, end, "> ");
    case "bulletList":
      return wrapLines(value, start, end, "- ");
    case "numberedList":
      return wrapLines(value, start, end, "1. ");
    default: {
      const _exhaustive: never = command;
      throw new Error(`Unhandled composer format: ${_exhaustive}`);
    }
  }
}

/** Insert a markdown link over the current range (replaces selection). */
export function applyMarkdownLink(
  value: string,
  start: number,
  end: number,
  text: string,
  url: string,
): TextSelectionResult | null {
  const link = buildMarkdownLink(text, url);
  if (!link) return null;

  const range = clampRange(value, start, end);
  const next = value.slice(0, range.start) + link + value.slice(range.end);
  return {
    text: next,
    selectionStart: range.start,
    selectionEnd: range.start + link.length,
  };
}
