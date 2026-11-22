"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks whether `TaskActivityComposer` is unmounting or hidden under
 * `<Activity>` and aborts any active attachment upload controllers on cleanup.
 */
export function useTaskActivityComposerUploadCleanup(
  activeUploadControllersRef: RefObject<Set<AbortController>>,
  isUnmountingRef: RefObject<boolean>,
): void {
  useEffect(() => {
    isUnmountingRef.current = false;
    const controllers = activeUploadControllersRef.current;
    return () => {
      isUnmountingRef.current = true;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);
}
