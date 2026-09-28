/** A markdown link, or else a bare URL; one pass so a link is judged once. */
const LINK_OR_URL =
  /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"'\])]+)/g;
const BARE_URL = /https?:\/\/[^\s<>"'\])]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Comparable form: no fragment, no trailing slash or punctuation. */
export function normalizeCitation(url: string): string {
  const trimmed = url.replace(TRAILING_PUNCTUATION, "");
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/** Every URL in a text or serialized value, normalized. */
export function citationsIn(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return (text.match(BARE_URL) ?? []).map(normalizeCitation);
}

function isSokosumiLink(url: string): boolean {
  try {
    const host = new URL(url.replace(TRAILING_PUNCTUATION, "")).hostname;
    return host === "sokosumi.com" || host.endsWith(".sokosumi.com");
  } catch {
    return false;
  }
}

/**
 * Removes links the turn has no grounds for: a cited page must be one the bot
 * found or loaded this turn, or one it was given. A link's text stays, and the
 * owner is told a link was left out.
 */
export function dropUnverifiedLinks(
  text: string,
  evidence: ReadonlySet<string>,
): { text: string; dropped: number } {
  let dropped = 0;
  const cleaned = text.replace(
    LINK_OR_URL,
    (match, label: string | undefined, linkUrl: string | undefined, bare) => {
      const url: string = linkUrl ?? bare;
      if (isSokosumiLink(url) || evidence.has(normalizeCitation(url)))
        return match;
      dropped += 1;
      if (label) return label;
      // Keep the punctuation that ended the sentence, not the address.
      return url.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    },
  );
  if (dropped === 0) return { text, dropped };
  return {
    text: `${cleaned
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd()}\n\nI left out ${dropped === 1 ? "a link" : `${dropped} links`} I could not confirm from a page I opened.`,
    dropped,
  };
}
