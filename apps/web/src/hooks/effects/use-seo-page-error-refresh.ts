"use client";

import type { useRouter } from "next/navigation";
import { useEffect } from "react";

type SeoPageErrorRouter = Pick<ReturnType<typeof useRouter>, "refresh">;

/**
 * Refreshes the SEO page route when `SeoPageError` asks the server page to
 * resolve the Audit's workspace and prompt a workspace switch.
 */
export function useSeoPageErrorRefresh(
  askPage: boolean,
  router: SeoPageErrorRouter,
): void {
  useEffect(() => {
    if (askPage) router.refresh();
  }, [askPage, router]);
}
