"use client";

import { useRouter } from "next/navigation";
import { type ComponentProps, type MouseEvent, useCallback } from "react";

import { RestingIntentLink } from "@/components/resting-intent-link";
import { canPrefetchRouteContent } from "@/lib/navigation/content-prefetch-routes";
import { navigateBack } from "@/lib/navigation/navigate-back";
import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";

type BackLinkProps = Omit<
  ComponentProps<typeof RestingIntentLink>,
  "prefetchContent" | "ref"
> & {
  /** False while `href` is a placeholder for a path not read yet. */
  prefetchOnMount?: boolean;
};

/** False for a link under `display: none`, e.g. the other breakpoint's back. */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Link back to a parent page. When the parent supports it, its content (not
 * only its loading skeleton) loads once the link is rendered: back is the
 * likely next step, and a touch gives no approach to predict from. A
 * predicted approach, a resting hover or focus loads it again once stale.
 *
 * A plain click goes back through history (`navigateBack`), never pushing
 * the parent, so the swipe-back gesture afterwards cannot reopen this page.
 * A caller's `onClick` that prevents the default takes over the click.
 */
export function BackLink({
  prefetchOnMount = true,
  onClick,
  ...props
}: BackLinkProps) {
  const router = useRouter();
  const { href } = props;
  const prefetchContent = canPrefetchRouteContent(href);
  const loadOnShow = prefetchContent && prefetchOnMount;

  // A new `href` is a new ref, so each target loads as the link shows it. The
  // page's own refresh after a navigation drops that load, so it loads again,
  // up to a few times, while this link still shows the same target.
  const showRef = useCallback(
    (element: HTMLAnchorElement | null) => {
      if (!element || !loadOnShow || !isRendered(element)) return;
      let shown = true;
      prefetchRouteContent(router, href, {
        keepLoaded: () => shown && isRendered(element),
      });
      return () => {
        shown = false;
      };
    },
    [router, href, loadOnShow],
  );

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigateBack(router, href);
  }

  return (
    <RestingIntentLink
      {...props}
      ref={showRef}
      prefetchContent={prefetchContent}
      onClick={handleClick}
    />
  );
}
