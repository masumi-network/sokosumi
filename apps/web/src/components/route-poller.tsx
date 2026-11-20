"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useInterval } from "@/hooks/effects/use-interval";

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
  const askedRef = useRef(0);
  const [askedCount, setAskedCount] = useState(0);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useInterval(
    () => {
      if (document.visibilityState === "hidden") return;
      if (askedRef.current >= times) return;
      askedRef.current += 1;
      setAskedCount(askedRef.current);
      startTransition(() => router.refresh());
    },
    isPending || askedCount >= times ? null : everyMs,
  );

  return null;
}
