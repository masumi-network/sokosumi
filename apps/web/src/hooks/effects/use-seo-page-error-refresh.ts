"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refreshes the SEO page route when `SeoPageError` asks the server page to
 * resolve the Audit's workspace and prompt a workspace switch.
 */
export function useSeoPageErrorRefresh(askPage: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (askPage) router.refresh();
  }, [askPage, router]);
}
