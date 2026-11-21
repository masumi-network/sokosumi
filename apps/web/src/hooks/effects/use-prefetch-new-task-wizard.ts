"use client";

import { useEffect } from "react";

// The wizard pulls in the whole task form, so it ships as its own chunk that
// is warmed once the shell is idle rather than on the shell's critical path.
export const loadNewTaskWizard = () =>
  import("@/app/components/new-task-wizard");

/**
 * Warms the lazy `NewTaskWizard` chunk once the browser is idle on mount,
 * falling back to a 2s timeout when `requestIdleCallback` is unavailable.
 */
export function usePrefetchNewTaskWizard(): void {
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(
        () => void loadNewTaskWizard(),
        {
          timeout: 2000,
        },
      );
      return () => window.cancelIdleCallback(handle);
    }
    const timeout = window.setTimeout(() => void loadNewTaskWizard(), 2000);
    return () => window.clearTimeout(timeout);
  }, []);
}
