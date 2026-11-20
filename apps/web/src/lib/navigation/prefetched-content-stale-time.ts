/**
 * How long, in seconds, the browser keeps the private reads of a prefetched
 * page. The `"use cache: private"` loaders set it as their `stale` time. Next
 * requires at least 30. Pages do not refresh on every arrival (each refresh
 * is one more server render), so this bounds how old a prefetched page's
 * data can be. A prefetch of a page visited in the last 5 minutes takes that
 * visit's copy instead; `RefreshPrefetchedPage` refreshes such a return once
 * it is older than this, and after back and forward.
 */
export const PREFETCHED_CONTENT_STALE_SECONDS = 30;
