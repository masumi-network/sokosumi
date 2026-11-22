"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Tracks the active CSV export run generation for `TasksExportDialog`.
 * Closing or unmounting while `open` is true increments `run.current` so an
 * in-flight export from an earlier open does not trigger a download.
 */
export function useTasksExportRun(open: boolean): RefObject<number> {
  // Cancel closes the dialog but cannot stop the action. Closing, or
  // unmounting while open, starts a new run, and an export from an earlier
  // run saves nothing. The content stays mounted while it animates out.
  const run = useRef(0);
  useEffect(() => {
    const wasOpen = open;
    return () => {
      if (wasOpen) run.current += 1;
    };
  }, [open]);
  return run;
}
