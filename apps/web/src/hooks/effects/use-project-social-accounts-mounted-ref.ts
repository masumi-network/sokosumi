"use client";

import { type RefObject, useEffect } from "react";

/**
 * Marks `ProjectSocialAccounts` mounted so async OAuth, sync, and disconnect
 * handlers skip feedback and state updates after unmount.
 */
export function useProjectSocialAccountsMountedRef(
  isMountedRef: RefObject<boolean>,
): void {
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);
}
