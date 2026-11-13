import { z } from "@hono/zod-openapi";

/**
 * Search Console search types, as the Search Analytics `type` field names them.
 * `news` is the News tab of Google Search; `googleNews` is news.google.com and the Google News app.
 */
export const SEO_SEARCH_TYPES = [
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
] as const;
export const seoSearchTypeSchema = z.enum(SEO_SEARCH_TYPES);
export type SeoSearchType = z.infer<typeof seoSearchTypeSchema>;

/** Discover and Google News show pages in a feed, with no search query: they have no query rows. */
export function seoSearchTypeHasQueries(type: SeoSearchType = "web"): boolean {
  return type !== "discover" && type !== "googleNews";
}
