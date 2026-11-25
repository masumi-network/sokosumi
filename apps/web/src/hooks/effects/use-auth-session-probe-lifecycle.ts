"use client";

import { type RefObject, useEffect } from "react";

/**
 * Tracks whether `AuthSessionGuard` is mounted, starts a session probe on mount
 * or React `<Activity>` reveal, and invalidates in-flight probes on unmount or
 * hide.
 */
export function useAuthSessionProbeLifecycle(
  mountedRef: RefObject<boolean>,
  probeGenerationRef: RefObject<number>,
  probe: () => Promise<void> | void,
): void {
  useEffect(() => {
    mountedRef.current = true;
    void probe();

    return () => {
      mountedRef.current = false;
      probeGenerationRef.current += 1;
    };
  }, [probe]);
}
