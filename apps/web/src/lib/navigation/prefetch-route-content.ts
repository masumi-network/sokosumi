// Not exported from `next/navigation`. `<Link prefetch={true}>` asks for the
// same kind (`next/dist/client/app-dir/link.js`), so this reaches the router's
// documented per-link prefetch from code that decides when to prefetch.
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * How many times one load repeats after the router drops it. Every
 * `router.refresh()` drops every prefetched page (a page that may show an old
 * copy, a live update, a revalidating action), and some pages poll with a
 * refresh, so the cap bounds the server renders one resting
 * pointer or shown link can start. On a page that polls every few seconds, a
 * rest longer than the cap's polls ends with the page dropped again: a click
 * then shows the loading skeleton, as before the reloads.
 */
export const MAX_CONTENT_RELOADS = 3;

interface PrefetchRouteContentOptions {
  /**
   * Asked each time the router drops the loaded page. True loads it again,
   * e.g. while the pointer still rests on the link.
   */
  keepLoaded?: () => boolean;
}

/**
 * Prefetches the page behind `href` with its content, not only the route's
 * shared App Shell. Measured on a Next 16.4.6 production build: the prefetch
 * carries the page only when every read it waits on is cached
 * (`"use cache: private"` for user data) and it never calls `connection()`.
 * An uncached read shows the loading skeleton on the click, as a plain
 * prefetch does. Each new prefetch is a server render of the page, so call
 * this when a pointer heads for the link or rests on it, never for every
 * link in view.
 */
export function prefetchRouteContent(
  router: AppRouterInstance,
  href: string,
  { keepLoaded }: PrefetchRouteContentOptions = {},
): void {
  load(router, href, keepLoaded, MAX_CONTENT_RELOADS);
}

function load(
  router: AppRouterInstance,
  href: string,
  keepLoaded: (() => boolean) | undefined,
  reloadsLeft: number,
): void {
  router.prefetch(href, {
    kind: PrefetchKind.FULL,
    // A `router.refresh()` drops prefetched pages. Next loads a visible
    // link's App Shell again, never this content.
    onInvalidate:
      keepLoaded && reloadsLeft > 0
        ? () => {
            if (keepLoaded()) load(router, href, keepLoaded, reloadsLeft - 1);
          }
        : undefined,
  });
}
