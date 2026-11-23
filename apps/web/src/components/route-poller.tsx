"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { useRoutePoller } from "@/hooks/effects/use-route-poller";

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

  useRoutePoller({
    asked,
    everyMs,
    isPending,
    router,
    startTransition,
    times,
  });

  return null;
}
