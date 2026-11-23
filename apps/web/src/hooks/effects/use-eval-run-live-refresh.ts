"use client";

import type { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 15_000;

/**
 * Refreshes the admin eval run route every 15 seconds while `EvalRunRefresh`
 * stays mounted.
 */
export function useEvalRunLiveRefresh(
  router: Pick<ReturnType<typeof useRouter>, "refresh">,
): void {
  // Syncs with the browser's clock: an external system, not derived state.
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
}
