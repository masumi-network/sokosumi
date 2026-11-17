"use client";

import { useRouter } from "next/navigation";
import { type ComponentProps, useCallback } from "react";

import { RestingIntentLink } from "@/components/resting-intent-link";
import { canPrefetchRouteContent } from "@/lib/navigation/content-prefetch-routes";
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
 */
export function BackLink({ prefetchOnMount = true, ...props }: BackLinkProps) {
  const router = useRouter();
  const { href } = props;
  const prefetchContent = canPrefetchRouteContent(href);
  const loadOnShow = prefetchContent && prefetchOnMount;

  // A new `href` is a new ref, so each target loads once.
  const showRef = useCallback(
    (element: HTMLAnchorElement | null) => {
      if (element && loadOnShow && isRendered(element)) {
        prefetchRouteContent(router, href);
      }
    },
    [router, href, loadOnShow],
  );

  return (
    <RestingIntentLink
      {...props}
      ref={showRef}
      prefetchContent={prefetchContent}
    />
  );
}
