/** Analytics channel slices accepted by SEO reads and syncs. */
export const SEO_TRAFFIC_CHANNELS = ["all", "organic", "ai_assistant"] as const;

/** Search Analytics type values supported by the native Search Console adapter. */
export const SEO_SEARCH_TYPES = [
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
] as const;

/** Search Console URL-prefix properties require the same origin and the registered path prefix. */
export function seoSearchUrlPrefixCovers(
  property: string,
  pageUrls: readonly string[],
) {
  if (!URL.canParse(property)) return false;
  const prefix = new URL(property);
  return (
    ["https:", "http:"].includes(prefix.protocol) &&
    !prefix.username &&
    !prefix.password &&
    pageUrls.every((url) => {
      const page = URL.parse(url);
      return (
        page?.origin === prefix.origin && page.href.startsWith(prefix.href)
      );
    })
  );
}

/** The SEO website includes its www alias and keeps other subdomains and ports separate. */
export function seoSearchSiteHost(url: string) {
  return new URL(url).host.replace(/^www\./, "");
}

/**
 * Discover and Google News show pages in a feed, with no search query: they have no query rows.
 * INFERRED from the Search Console help, not the Search Analytics API page, which does not say
 * the query dimension is unsupported for these types.
 */
export function seoSearchTypeHasQueries(
  type: (typeof SEO_SEARCH_TYPES)[number] = "web",
): boolean {
  return type !== "discover" && type !== "googleNews";
}
