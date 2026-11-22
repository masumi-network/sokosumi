"use client";

import { useEffect, useRef } from "react";

/**
 * Resolves queued `whenSettled()` promises for `useWorkspaceSwitcher` once
 * `isPending` transitions to `false`.
 */
export function useWorkspaceSwitchSettlers(
  isPending: boolean,
): () => Promise<void> {
  const settlersRef = useRef<Array<() => void>>([]);

  // The refresh runs in this hook's transition, so only its pending state
  // says when the new workspace has rendered.
  useEffect(() => {
    if (isPending) return;
    for (const settle of settlersRef.current.splice(0)) settle();
  }, [isPending]);

  /** Resolves once the next switch has rendered. Ask before starting it. */
  const whenSettled = () =>
    new Promise<void>((resolve) => {
      settlersRef.current.push(resolve);
    });

  return whenSettled;
}
