import {
  collectMarkdownUrlExcludedRanges,
  findBareHttpUrlHits,
  findMarkdownLinks,
  MARKDOWN_FENCED_BLOCK_REGEX,
  replaceMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";

interface Range {
  start: number;
  end: number;
}

/** A source longer than this is not worth keeping; the runtime route caps it. */
const MAX_SOURCE_LENGTH = 2_000;

/** Comparable form: no scheme, fragment, or trailing slash; host lowercased. */
export function normalizeCitation(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Every web address in a value, as written: its strings are read one by one,
 * not its serialized JSON, whose escapes would run into the addresses.
 */
export function urlsIn(value: unknown): string[] {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object")
      Object.values(node).forEach(walk);
  };
  walk(value);
  const urls = texts.flatMap((text) => [
    ...findMarkdownLinks(text).map((link) =>
      unescapeMarkdownLinkUrl(link.rawUrl),
    ),
    ...findBareHttpUrlHits(text, collectMarkdownUrlExcludedRanges(text)).map(
      (hit) => hit.url,
    ),
  ]);
  return [...new Set(urls.filter((url) => url.length <= MAX_SOURCE_LENGTH))];
}

/** Every web address in a value, normalized for comparison. */
export function citationsIn(value: unknown): string[] {
  return urlsIn(value).flatMap((url) => normalizeCitation(url) ?? []);
}

/** Fenced blocks and inline code: addresses there are examples, not citations. */
function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(MARKDOWN_FENCED_BLOCK_REGEX)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  let open = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") open = -1;
    else if (text[index] === "`") {
      if (open === -1) open = index;
      else {
        ranges.push({ start: open, end: index + 1 });
        open = -1;
      }
    }
  }
  return ranges;
}

function inside(index: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function isSokosumiHost(normalized: string): boolean {
  const host = normalized.split("/")[0]?.split(":")[0] ?? "";
  return host === "sokosumi.com" || host.endsWith(".sokosumi.com");
}

/**
 * Removes links the turn has no grounds for: a cited page must be one the bot
 * found or loaded this turn, or one it was given. A link keeps its text, the
 * address goes, and the owner is told. Relative links, Sokosumi links and
 * addresses inside code are left alone.
 */
export function dropUnverifiedLinks(
  text: string,
  evidence: ReadonlySet<string>,
): { text: string; dropped: number } {
  let dropped = 0;
  const unverified = (url: string) => {
    const normalized = normalizeCitation(url);
    return (
      normalized !== null &&
      !isSokosumiHost(normalized) &&
      !evidence.has(normalized)
    );
  };
  const linkCode = codeRanges(text);
  const withoutLinks = replaceMarkdownLinks(text, (link) => {
    if (inside(link.index, linkCode)) return link.match;
    if (!unverified(unescapeMarkdownLinkUrl(link.rawUrl))) return link.match;
    dropped += 1;
    return link.text;
  });
  const bareCode = codeRanges(withoutLinks);
  const hits = findBareHttpUrlHits(
    withoutLinks,
    collectMarkdownUrlExcludedRanges(withoutLinks),
  ).filter((hit) => !inside(hit.start, bareCode) && unverified(hit.url));
  let cleaned = withoutLinks;
  for (const hit of [...hits].reverse())
    cleaned =
      cleaned.slice(0, hit.start) + cleaned.slice(hit.start + hit.url.length);
  dropped += hits.length;
  if (dropped === 0) return { text, dropped };
  return {
    text: `${cleaned.trimEnd()}\n\nI left out ${dropped === 1 ? "a link" : `${dropped} links`} I could not confirm from a page I opened.`,
    dropped,
  };
}
