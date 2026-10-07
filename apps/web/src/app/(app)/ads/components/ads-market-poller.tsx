"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

const POLL_MS = 20_000;

/**
 * Asks the route for fresh data every 20 seconds while it is mounted. Mount it
 * only while Core is gathering; once the ads are ready it is no longer
 * rendered. Waits for a refresh in flight and skips a hidden tab.
 */
export function AdsMarketPoller() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (isPending) return;

    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      startTransition(() => router.refresh());
    }, POLL_MS);
    return () => clearInterval(id);
  }, [isPending, router]);

  return null;
}
