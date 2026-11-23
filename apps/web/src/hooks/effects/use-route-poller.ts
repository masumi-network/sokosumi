"use client";

import type { useRouter } from "next/navigation";
import { type RefObject, type TransitionStartFunction, useEffect } from "react";

export interface UseRoutePollerOptions {
  asked: RefObject<number>;
  everyMs: number;
  isPending: boolean;
  router: Pick<ReturnType<typeof useRouter>, "refresh">;
  startTransition: TransitionStartFunction;
  times: number;
}

/**
 * Polls `router.refresh()` inside `startTransition` every `everyMs` while the
 * tab is visible, pausing during pending transitions and stopping after
 * `times` refreshes.
 */
export function useRoutePoller({
  asked,
  everyMs,
  isPending,
  router,
  startTransition,
  times,
}: UseRoutePollerOptions): void {
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
}
