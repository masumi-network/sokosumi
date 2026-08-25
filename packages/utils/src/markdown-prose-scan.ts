import { findMarkdownLinks } from "./markdown-links.js";

export interface MarkdownProseRange {
  start: number;
  end: number;
}

export function isFenceChar(ch: string): ch is "`" | "~" {
  return ch === "`" || ch === "~";
}

/** Skip a CommonMark/GFM fenced code block opened with `` ` `` or `~` (length ≥ 3). */
export function skipFencedCode(
  text: string,
  openIndex: number,
  fenceChar: "`" | "~",
): number {
  let i = openIndex;
  let fenceLen = 0;
  while (i < text.length && text[i] === fenceChar) {
    fenceLen += 1;
    i += 1;
  }
  if (fenceLen < 3) {
    return openIndex;
  }
  while (i < text.length && text[i] !== "\n") {
    i += 1;
  }
  if (i < text.length && text[i] === "\n") i += 1;

  while (i < text.length) {
    if (text[i] === fenceChar) {
      let closeLen = 0;
      const closeStart = i;
      while (i < text.length && text[i] === fenceChar) {
        closeLen += 1;
        i += 1;
      }
      if (closeLen >= fenceLen) {
        return i;
      }
      i = closeStart + 1;
      continue;
    }
    i += 1;
  }
  return text.length;
}

export function skipInlineCode(text: string, openIndex: number): number {
  let fenceLen = 0;
  let i = openIndex;
  while (i < text.length && text[i] === "`") {
    fenceLen += 1;
    i += 1;
  }
  if (fenceLen === 0 || fenceLen >= 3) return openIndex;

  while (i < text.length) {
    if (text[i] === "`") {
      let closeLen = 0;
      const closeStart = i;
      while (i < text.length && text[i] === "`") {
        closeLen += 1;
        i += 1;
      }
      if (closeLen === fenceLen) {
        return i;
      }
      i = closeStart + 1;
      continue;
    }
    if (text[i] === "\n") {
      return openIndex + 1;
    }
    i += 1;
  }
  return openIndex + 1;
}

export function collectMarkdownLinkRanges(
  markdown: string,
): MarkdownProseRange[] {
  return findMarkdownLinks(markdown).map((link) => ({
    start: link.index,
    end: link.index + link.match.length,
  }));
}

export function rangeContaining(
  ranges: MarkdownProseRange[],
  index: number,
): MarkdownProseRange | null {
  for (const range of ranges) {
    if (index >= range.start && index < range.end) {
      return range;
    }
  }
  return null;
}

/** Escape characters that break or reformat Markdown link labels. */
export function escapeMarkdownLinkLabel(label: string): string {
  let out = "";
  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i]!;
    if (
      ch === "\\" ||
      ch === "[" ||
      ch === "]" ||
      ch === "*" ||
      ch === "_" ||
      ch === "~"
    ) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}
