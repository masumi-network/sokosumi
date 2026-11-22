"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Holds the automatic retry timeout for `StudioImage` and clears any pending
 * retry on unmount or React `<Activity>` hide.
 */
export function useStudioImageRetryCleanup(): RefObject<ReturnType<
  typeof setTimeout
> | null> {
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );
  return retryTimer;
}
