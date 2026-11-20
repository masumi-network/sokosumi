"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { matchesMediaQuery, subscribeMediaQuery } from "./use-media-query";

/** Calls `router.replace(href)` at most once when `query` matches on the client. */
export function useReplaceRouteOnMedia(query: string, href: string): void {
  const router = useRouter();
  const hasReplacedRef = useRef(false);

  useEffect(() => {
    function tryReplace() {
      if (!matchesMediaQuery(query) || hasReplacedRef.current) {
        return;
      }
      hasReplacedRef.current = true;
      router.replace(href);
    }

    tryReplace();
    return subscribeMediaQuery(query, tryReplace);
  }, [query, href, router]);
}
