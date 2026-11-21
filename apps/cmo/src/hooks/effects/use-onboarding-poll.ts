"use client";

import { useEffect } from "react";

export interface UseOnboardingPollOptions {
  pollMs: number;
  hiddenPollMs: number;
}

/**
 * Polls onboarding progress while the tab is visible and at a slower cadence
 * while hidden, refreshing immediately when the tab returns to visibility.
 */
export function useOnboardingPoll(
  refresh: () => void | Promise<void>,
  { pollMs, hiddenPollMs }: UseOnboardingPollOptions,
): void {
  useEffect(() => {
    let last = Date.now();
    const poll = () => {
      const visible = document.visibilityState === "visible";
      if (!visible && Date.now() - last < hiddenPollMs) return;
      last = Date.now();
      void refresh();
    };
    const timer = window.setInterval(poll, pollMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh, pollMs, hiddenPollMs]);
}
