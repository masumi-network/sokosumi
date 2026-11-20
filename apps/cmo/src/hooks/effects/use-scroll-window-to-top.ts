"use client";

import { useEffect } from "react";

/**
 * Scrolls the window to the top whenever `trigger` changes.
 */
export function useScrollWindowToTop(trigger: unknown): void {
  useEffect(() => {
    void trigger;
    window.scrollTo(0, 0);
  }, [trigger]);
}
