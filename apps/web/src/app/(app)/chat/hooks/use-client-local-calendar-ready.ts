"use client";

import useIsClient from "@/hooks/use-is-client";

/**
 * True only after mount. SSR and the first client render stay `false` so
 * local-calendar UI (day separators, wall-clock times) matches hydrate, then
 * swaps to the browser TZ/locale — same pattern as `TimeAgo` (SOKOSUMI-A).
 */
export function useClientLocalCalendarReady(): boolean {
  return useIsClient();
}
