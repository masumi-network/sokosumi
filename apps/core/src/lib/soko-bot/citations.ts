import {
  collectMarkdownUrlExcludedRanges,
  findBareHttpUrlHits,
  findHttpAutolinks,
  findMarkdownLinks,
  linkifyBareDomainsInMarkdown,
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
  const bare =
    url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
  try {
    const parsed = new URL(bare.startsWith("//") ? `https:${bare}` : bare);
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
    ...findHttpAutolinks(text).map((hit) => hit.url),
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

/**
 * Code the renderer will show as code, where an address is an example rather
 * than a citation: fenced blocks (``` or ~~~, running to the end when never
 * closed) and inline spans between unescaped backticks.
 */
function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let fence: { marker: string; start: number } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (
        marker?.[0] === fence.marker[0] &&
        marker.length >= fence.marker.length
      ) {
        ranges.push({ start: fence.start, end: offset + line.length });
        fence = null;
      }
    } else if (marker) {
      fence = { marker, start: offset };
    } else {
      let open = -1;
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "\\") index += 1;
        else if (line[index] === "`") {
          if (open === -1) open = index;
          else {
            ranges.push({ start: offset + open, end: offset + index + 1 });
            open = -1;
          }
        }
      }
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push({ start: fence.start, end: text.length });
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
 * addresses inside code are left alone. Bare domains are read the way the
 * web renders them, as links.
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
  // Remove from the end so earlier offsets stay valid.
  const cut = (value: string, ranges: Range[]) =>
    [...ranges]
      .sort((a, b) => b.start - a.start)
      .reduce(
        (result, range) =>
          result.slice(0, range.start) + result.slice(range.end),
        value,
      );

  const linked = linkifyBareDomainsInMarkdown(text);
  const linkCode = codeRanges(linked);
  const withoutLinks = replaceMarkdownLinks(linked, (link) => {
    if (inside(link.index, linkCode)) return link.match;
    if (!unverified(unescapeMarkdownLinkUrl(link.rawUrl))) return link.match;
    dropped += 1;
    // A label that is itself an address would be linked again on render.
    return linkifyBareDomainsInMarkdown(link.text) === link.text &&
      findBareHttpUrlHits(link.text).length === 0
      ? link.text
      : "";
  });

  const autolinkCode = codeRanges(withoutLinks);
  const autolinks = findHttpAutolinks(withoutLinks).filter(
    (hit) => !inside(hit.start, autolinkCode) && unverified(hit.url),
  );
  dropped += autolinks.length;
  const withoutAutolinks = cut(withoutLinks, autolinks);

  const bareCode = codeRanges(withoutAutolinks);
  const bare = findBareHttpUrlHits(
    withoutAutolinks,
    collectMarkdownUrlExcludedRanges(withoutAutolinks),
  )
    .filter((hit) => !inside(hit.start, bareCode) && unverified(hit.url))
    .map((hit) => ({ start: hit.start, end: hit.start + hit.url.length }));
  dropped += bare.length;
  const cleaned = cut(withoutAutolinks, bare);

  if (dropped === 0) return { text, dropped };
  return {
    text: `${cleaned.trimEnd()}\n\nI left out ${dropped === 1 ? "a link" : `${dropped} links`} I could not confirm from a page I opened.`,
    dropped,
  };
}
