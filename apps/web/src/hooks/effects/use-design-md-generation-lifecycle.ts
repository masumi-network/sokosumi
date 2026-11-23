"use client";

import { type RefObject, useEffect } from "react";

/**
 * Sets `mountedRef.current` on mount and resets it while clearing any pending
 * poll timeout on cleanup for `useDesignMdGeneration`.
 */
export function useDesignMdGenerationLifecycle(
  mountedRef: RefObject<boolean>,
  clearPollTimeout: () => void,
): void {
  useEffect(() => {
    // Set again on mount: a Strict Mode remount keeps the refs it unmounted.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPollTimeout();
    };
  }, [clearPollTimeout]);
}
