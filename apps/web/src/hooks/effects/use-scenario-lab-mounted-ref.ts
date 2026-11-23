"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks `ScenarioLab` mount state so async run loops stop starting actions
 * after unmount or Activity hide.
 */
export function useScenarioLabMountedRef(mountedRef: RefObject<boolean>): void {
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
}
