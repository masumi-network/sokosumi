"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Holds `projectId` only while `useStudioState` is committed and visible,
 * clearing it in layout cleanup on project switch, unmount, or React
 * `<Activity>` hide so late replies never mutate state or the URL.
 */
export function useStudioStateActiveProjectRef(
  projectId: string | null,
): RefObject<string | null> {
  const activeProjectIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeProjectIdRef.current = projectId;
    return () => {
      activeProjectIdRef.current = null;
    };
  }, [projectId]);
  return activeProjectIdRef;
}
