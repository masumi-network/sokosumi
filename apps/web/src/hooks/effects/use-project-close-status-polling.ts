"use client";

import type { ProjectCloseStatus } from "@sokosumi/core-client";
import type { useRouter } from "next/navigation";
import { type TransitionStartFunction, useEffect } from "react";

type ProjectCloseStatusRouter = Pick<ReturnType<typeof useRouter>, "refresh">;

/**
 * Polls the server page every five seconds while a project is `CLOSING` and no
 * transition is already in flight.
 */
export function useProjectCloseStatusPolling(
  state: ProjectCloseStatus["state"],
  isPending: boolean,
  startTransition: TransitionStartFunction,
  router: ProjectCloseStatusRouter,
): void {
  useEffect(() => {
    if (state !== "CLOSING" || isPending) return;

    const interval = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [state, isPending, router]);
}
