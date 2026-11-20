"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

import type { FocusableElement } from "./use-focus-when";

/**
 * Moves focus to `targetRef.current` on mount and restores focus to the
 * previous `document.activeElement` (with `preventScroll: true`) on unmount.
 */
export function useFocusWithRestore(
  targetRef: RefObject<FocusableElement | null>,
): void {
  const getTarget = useEffectEvent(() => targetRef.current);

  useEffect(() => {
    const opener = document.activeElement;
    getTarget()?.focus();
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
}
