"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks whether `useGenerationQueue` is mounted and cancels any pending busy
 * retry timeout on unmount or React `<Activity>` hide.
 */
export function useGenerationQueueMountLifecycle(
  mountedRef: RefObject<boolean>,
  retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);
}
