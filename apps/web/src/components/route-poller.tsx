"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * Asks the route for fresh data every `everyMs` while it is mounted. Mount it
 * only while Core is working on something no action waits for; once that is
 * done it is no longer rendered. Waits for a refresh in flight and skips a
 * hidden tab. `times` ends the asking for work that may never finish.
 */
export function RoutePoller({
  everyMs,
  times = Number.POSITIVE_INFINITY,
}: {
  everyMs: number;
  times?: number;
}) {
  const asked = useRef(0);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (isPending) return;

    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (asked.current >= times) return clearInterval(id);
      asked.current += 1;
      startTransition(() => router.refresh());
    }, everyMs);
    return () => clearInterval(id);
  }, [everyMs, isPending, router, times]);

  return null;
}
