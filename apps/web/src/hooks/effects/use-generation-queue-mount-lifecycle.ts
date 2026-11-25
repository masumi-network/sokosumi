"use client";

import { type RefObject, useEffect, useLayoutEffect } from "react";

/**
 * Tracks whether `useGenerationQueue` is mounted and visible: marks mounted in
 * passive setup (before the queue's passive drain runs) and clears `mountedRef`
 * plus any pending busy retry timeout synchronously in layout cleanup on
 * unmount or React `<Activity>` hide so acceptances during the hide window
 * cannot fire late navigation or refresh callbacks.
 */
export function useGenerationQueueMountLifecycle(
  mountedRef: RefObject<boolean>,
  retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useLayoutEffect(() => {
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
  }, []);
}
