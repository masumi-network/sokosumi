"use client";

import { type RefObject, useEffect } from "react";

/**
 * Sets the grab cursor on the Agents `Categories` horizontal scroll container
 * on mount and clears inline cursor/userSelect styles on cleanup.
 */
export function useCategoriesDragCursor(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.style.cursor = "grab";

    return () => {
      container.style.cursor = "";
      container.style.userSelect = "";
    };
  }, []);
}
