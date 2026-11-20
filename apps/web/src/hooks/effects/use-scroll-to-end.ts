"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

export interface UseScrollToEndOptions {
  /** Axis to scroll to its end. Defaults to `"vertical"`. */
  axis?: "vertical" | "horizontal";
  /** Skips scrolling while `false`. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Scrolls `targetRef.current` to its vertical or horizontal end whenever
 * `trigger` changes while `enabled` is true.
 */
export function useScrollToEnd(
  targetRef: RefObject<HTMLElement | null>,
  trigger: unknown,
  options?: UseScrollToEndOptions,
): void {
  const getTarget = useEffectEvent(() => targetRef.current);
  const axis = options?.axis ?? "vertical";
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    void trigger;
    if (!enabled) return;

    const element = getTarget();
    if (!element) return;

    if (axis === "horizontal") {
      element.scrollLeft = element.scrollWidth;
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, [trigger, axis, enabled]);
}
