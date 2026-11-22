"use client";

import { type RefObject, useEffect } from "react";

/**
 * Runs `DriveRecentsPanel`'s current recents loader and aborts any in-flight
 * initial or load-more request on dependency change or unmount.
 */
export function useDriveRecentsLoad(
  loadRecents: () => Promise<void>,
  loadAbortRef: RefObject<AbortController | null>,
  loadMoreAbortRef: RefObject<AbortController | null>,
): void {
  useEffect(() => {
    void loadRecents();
    return () => {
      loadAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, [loadRecents]);
}
