/**
 * How long, in seconds, the browser keeps the private reads of a prefetched
 * page. The `"use cache: private"` loaders set it as their `stale` time. Next
 * requires at least 30.
 */
export const PREFETCHED_CONTENT_STALE_SECONDS = 60;
