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
