"use client";

import { type RefObject, useEffect } from "react";

/**
 * Clears any pending `ComposerWysiwygEditor` blur timeout when the editor
 * unmounts (keeping `main`'s non-cancelling timer behaviour intact).
 */
export function useComposerBlurTimeoutCleanup(
  blurTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);
}
