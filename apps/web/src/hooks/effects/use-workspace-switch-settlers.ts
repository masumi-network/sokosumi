"use client";

import { type RefObject, useEffect } from "react";

/**
 * Resolves queued `whenSettled()` promises in `settlersRef` for
 * `useWorkspaceSwitcher` once `isPending` transitions to `false`.
 */
export function useWorkspaceSwitchSettlers(
  settlersRef: RefObject<Array<() => void>>,
  isPending: boolean,
): void {
  // The refresh runs in this hook's transition, so only its pending state
  // says when the new workspace has rendered.
  useEffect(() => {
    if (isPending) return;
    for (const settle of settlersRef.current.splice(0)) settle();
  }, [isPending]);
}
