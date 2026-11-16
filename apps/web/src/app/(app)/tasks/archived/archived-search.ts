/** Core's GET /tasks `q` limit; a longer search fails the whole list. */
export const ARCHIVED_SEARCH_MAX_LENGTH = 200;

/**
 * The archived search from the URL, trimmed and cut to Core's limit, so a long
 * pasted name or a hand-edited link still lists matches instead of failing.
 */
export function readArchivedSearch(
  raw: string | string[] | undefined,
): string | undefined {
  const value = (Array.isArray(raw) ? raw[0] : raw)
    ?.trim()
    .slice(0, ARCHIVED_SEARCH_MAX_LENGTH)
    // A cut through an emoji leaves half a surrogate pair, which the Core
    // client cannot URL-encode; drop it.
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();
  return value || undefined;
}
