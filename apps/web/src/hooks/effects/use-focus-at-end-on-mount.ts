"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

export interface FocusAtEndHandle {
  focusAtEnd(): void;
}

/**
 * Focuses an imperative editor handle at the end of its content once on mount
 * (or React Activity reveal).
 */
export function useFocusAtEndOnMount(
  targetRef: RefObject<FocusAtEndHandle | null>,
): void {
  const focusAtEnd = useEffectEvent(() => {
    targetRef.current?.focusAtEnd();
  });

  useEffect(() => {
    focusAtEnd();
  }, []);
}
