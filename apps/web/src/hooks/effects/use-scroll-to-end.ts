"use client";

import { useEffect } from "react";

export interface UseScrollToEndOptions {
  /** Axis to scroll to its end. Defaults to `"vertical"`. */
  axis?: "vertical" | "horizontal";
  /** Skips scrolling while `false`. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Scrolls a live overflow container to its vertical or horizontal end whenever
 * `trigger` changes while `enabled` is true.
 */
export function useScrollToEnd(
  element: HTMLElement | null | undefined,
  trigger: unknown,
  options?: UseScrollToEndOptions,
): void {
  const axis = options?.axis ?? "vertical";
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    void trigger;
    if (!enabled || !element) return;

    if (axis === "horizontal") {
      element.scrollLeft = element.scrollWidth;
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, [element, trigger, axis, enabled]);
}
