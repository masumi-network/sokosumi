// Not exported from `next/navigation`. `<Link prefetch={true}>` asks for the
// same kind (`next/dist/client/app-dir/link.js`), so this reaches the router's
// documented per-link prefetch from code that decides when to prefetch.
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Prefetches the page behind `href` with its content, not only the route's
 * shared App Shell. Measured on a Next 16.4.6 production build: the prefetch
 * carries the page only when every read it waits on is cached
 * (`"use cache: private"` for user data) and it never calls `connection()`.
 * An uncached read shows the loading skeleton on the click, as a plain
 * prefetch does. Each new prefetch is a server render of the page, so call
 * this when the reader shows clear intent, not for every predicted approach.
 */
export function prefetchRouteContent(
  router: AppRouterInstance,
  href: string,
): void {
  router.prefetch(href, { kind: PrefetchKind.FULL });
}
