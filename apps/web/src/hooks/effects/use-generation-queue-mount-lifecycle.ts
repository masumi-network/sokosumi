"use client";

import { type RefObject, useLayoutEffect } from "react";

/**
 * Tracks whether `useGenerationQueue` is mounted and visible in the layout
 * phase, clearing `mountedRef` and any pending busy retry timeout synchronously
 * on unmount or React `<Activity>` hide so acceptances during the hide window
 * cannot fire late navigation or refresh callbacks.
 */
export function useGenerationQueueMountLifecycle(
  mountedRef: RefObject<boolean>,
  retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);
}
