"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface UseRouterRedirectOptions {
  /** Navigation method: `"replace"` (default) avoids extra history entries. */
  mode?: "replace" | "push";
  /** Navigate at most once per mount even if `href` changes or Activity re-reveals. */
  once?: boolean;
  /** Passed to `router.replace`/`router.push` only when explicitly set. */
  scroll?: boolean;
}

/**
 * Navigates with Next.js App Router whenever `href` becomes non-null.
 *
 * Keeps client-side redirects out of render while preserving passive effect
 * timing, StrictMode safety, and optional one-shot semantics (`once: true`).
 */
export function useRouterRedirect(
  href: string | null,
  options?: UseRouterRedirectOptions,
): void {
  const router = useRouter();
  const hasRedirectedRef = useRef(false);
  const mode = options?.mode ?? "replace";
  const once = options?.once ?? false;
  const scroll = options?.scroll;

  useEffect(() => {
    if (!href) return;
    if (once && hasRedirectedRef.current) return;
    if (once) hasRedirectedRef.current = true;

    if (mode === "push") {
      if (scroll === undefined) router.push(href);
      else router.push(href, { scroll });
    } else if (scroll === undefined) {
      router.replace(href);
    } else {
      router.replace(href, { scroll });
    }
  }, [href, mode, once, router, scroll]);
}

/**
 * Calls `router.refresh()` whenever `shouldRefresh` becomes `true`.
 */
export function useRouterRefreshWhen(shouldRefresh: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!shouldRefresh) return;
    router.refresh();
  }, [router, shouldRefresh]);
}
