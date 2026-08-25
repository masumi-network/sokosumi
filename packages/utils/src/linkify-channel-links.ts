import { escapeMarkdownLinkUrl, findMarkdownLinks } from "./markdown-links.js";

export interface ChannelLinkTarget {
  name: string;
  slug: string;
  href: string;
}

interface IndexRange {
  start: number;
  end: number;
}

const TOKEN_CONTINUATION = /[\p{L}\p{N}_-]/u;

function isWhitespaceChar(ch: string): boolean {
  return ch.trim() === "";
}

function isFenceChar(ch: string): ch is "`" | "~" {
  return ch === "`" || ch === "~";
}

function skipFencedCode(
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

function skipInlineCode(text: string, openIndex: number): number {
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

function collectMarkdownLinkRanges(markdown: string): IndexRange[] {
  return findMarkdownLinks(markdown).map((link) => ({
    start: link.index,
    end: link.index + link.match.length,
  }));
}

function rangeContaining(
  ranges: IndexRange[],
  index: number,
): IndexRange | null {
  for (const range of ranges) {
    if (index >= range.start && index < range.end) {
      return range;
    }
  }
  return null;
}

function escapeMarkdownLinkLabel(label: string): string {
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

function isMatchBoundary(text: string, end: number): boolean {
  if (end >= text.length) return true;
  return !TOKEN_CONTINUATION.test(text[end]!);
}

function uniqueKeys(channel: ChannelLinkTarget): string[] {
  const name = channel.name.trim();
  const slug = channel.slug.trim();
  if (name.length === 0 && slug.length === 0) return [];
  if (name.toLowerCase() === slug.toLowerCase()) {
    return name.length > 0 ? [name] : [slug];
  }
  const keys: string[] = [];
  if (name.length > 0) keys.push(name);
  if (slug.length > 0) keys.push(slug);
  return keys;
}

function findChannelMatch(
  text: string,
  startAfterHash: number,
  channels: readonly ChannelLinkTarget[],
): { href: string; end: number } | null {
  const rest = text.slice(startAfterHash);
  const restLower = rest.toLowerCase();
  let bestLen = 0;
  let bestHref: string | null = null;
  let tied = false;

  for (const channel of channels) {
    for (const key of uniqueKeys(channel)) {
      if (!restLower.startsWith(key.toLowerCase())) continue;
      const end = startAfterHash + key.length;
      if (!isMatchBoundary(text, end)) continue;
      if (key.length > bestLen) {
        bestLen = key.length;
        bestHref = channel.href;
        tied = false;
      } else if (key.length === bestLen && channel.href !== bestHref) {
        tied = true;
      }
    }
  }

  if (tied || bestHref == null || bestLen === 0) return null;
  return { href: bestHref, end: startAfterHash + bestLen };
}

/**
 * Display-time helper: rewrite `#name` / `#slug` in markdown prose into
 * `[#typed](href)` links for membership-visible Channels. Skips code, existing
 * links, hash runs, headings (`# `), and mid-token `#`. Does not mutate stored
 * bodies — callers apply this only on render.
 */
export function linkifyChannelLinksInMarkdown(
  markdown: string,
  channels: readonly ChannelLinkTarget[],
): string {
  if (!markdown || channels.length === 0) return markdown;

  const mdLinkRanges = collectMarkdownLinkRanges(markdown);
  let result = "";
  let i = 0;
  const len = markdown.length;

  while (i < len) {
    const insideLink = rangeContaining(mdLinkRanges, i);
    if (insideLink) {
      result += markdown.slice(i, insideLink.end);
      i = insideLink.end;
      continue;
    }

    const ch = markdown[i]!;

    if (isFenceChar(ch)) {
      let fenceLen = 0;
      let j = i;
      while (j < len && markdown[j] === ch) {
        fenceLen += 1;
        j += 1;
      }
      if (fenceLen >= 3) {
        const end = skipFencedCode(markdown, i, ch);
        result += markdown.slice(i, end);
        i = end;
        continue;
      }
      if (ch === "`") {
        const end = skipInlineCode(markdown, i);
        result += markdown.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === "<") {
      const close = markdown.indexOf(">", i + 1);
      if (close !== -1) {
        result += markdown.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      result += ch;
      i += 1;
      continue;
    }

    if (ch === "#") {
      let hashEnd = i;
      while (hashEnd < len && markdown[hashEnd] === "#") {
        hashEnd += 1;
      }
      if (hashEnd - i !== 1) {
        result += markdown.slice(i, hashEnd);
        i = hashEnd;
        continue;
      }

      const atBoundary = i === 0 || isWhitespaceChar(markdown[i - 1]!);
      const next = markdown[i + 1];
      if (atBoundary && next !== undefined && !isWhitespaceChar(next)) {
        const hit = findChannelMatch(markdown, i + 1, channels);
        if (hit) {
          const label = markdown.slice(i, hit.end);
          result += `[${escapeMarkdownLinkLabel(label)}](${escapeMarkdownLinkUrl(hit.href)})`;
          i = hit.end;
          continue;
        }
      }
    }

    result += ch;
    i += 1;
  }

  return result;
}

/** Plain text the composer `#` picker inserts (`#name` or `#slug`). */
export function channelLinkInsertText(
  channel: Pick<ChannelLinkTarget, "name" | "slug">,
  channels: readonly Pick<ChannelLinkTarget, "name">[],
): string {
  const needle = channel.name.toLowerCase();
  let count = 0;
  for (const candidate of channels) {
    if (candidate.name.toLowerCase() === needle) {
      count += 1;
      if (count > 1) break;
    }
  }
  const body = count === 1 ? channel.name : channel.slug;
  return `#${body}`;
}
