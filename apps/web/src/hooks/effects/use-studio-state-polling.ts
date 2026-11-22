"use client";

import { useEffect } from "react";

const IDLE_POLL_MS = 15_000;
const ACTIVE_POLL_MS = 3_000;

export function useStudioStatePolling(
  projectId: string | null,
  hasActive: boolean,
  refresh: () => Promise<void>,
): void {
  // Synchronizing with a server is exactly what an Effect is for. The interval
  // tightens while something is in flight and relaxes when nothing is.
  useEffect(() => {
    if (!projectId) return;
    const period = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const timer = setInterval(() => {
      void refresh();
    }, period);
    return () => clearInterval(timer);
  }, [projectId, hasActive, refresh]);
}
