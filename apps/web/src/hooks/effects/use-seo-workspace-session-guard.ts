"use client";

import { type RefObject, useEffect } from "react";
import { toast } from "sonner";

/**
 * Tracks the active viewer/workspace session key for `useSeoWorkspace` and
 * retires the key plus any unconfirmed launch toast on session change,
 * unmount, or React `<Activity>` hide.
 */
export function useSeoWorkspaceSessionGuard<T extends { toastId: string }>(
  sessionKey: string,
  activeSessionKey: RefObject<string | null>,
  unconfirmed: RefObject<T | null>,
): void {
  useEffect(() => {
    activeSessionKey.current = sessionKey;
    return () => {
      activeSessionKey.current = null;
      if (unconfirmed.current) toast.dismiss?.(unconfirmed.current.toastId);
      unconfirmed.current = null;
    };
  }, [sessionKey]);
}
