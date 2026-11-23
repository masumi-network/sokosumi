"use client";

import { useEffect } from "react";

const POLL_MS = 4_000;

/**
 * Polls `CmoApp` state every four seconds while the document is visible and
 * refreshes immediately when visibility returns.
 */
export function useCmoAppPoll(refresh: () => Promise<void> | void): void {
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);
}
