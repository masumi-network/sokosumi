"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Moves focus into `SidePanel` on mount and restores focus to the element that
 * opened it (with `preventScroll: true`) on unmount.
 */
export function useSidePanelFocus(
  sheetRef: RefObject<HTMLElement | null>,
): void {
  const getSheet = useEffectEvent(() => sheetRef.current);

  useEffect(() => {
    const opener = document.activeElement;
    getSheet()?.focus();
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
}
