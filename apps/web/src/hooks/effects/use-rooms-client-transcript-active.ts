"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Tracks whether `useRetainedTranscript` in `RoomsClient` is currently mounted
 * and active before paint, clearing on unmount or React `<Activity>` hide and
 * restoring on reveal.
 */
export function useRoomsClientTranscriptActive(): RefObject<boolean> {
  const activeRef = useRef(true);
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  return activeRef;
}
