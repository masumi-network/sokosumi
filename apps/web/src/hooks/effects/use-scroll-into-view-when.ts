"use client";

import { useEffect } from "react";

import {
  matchesMediaQuery,
  REDUCED_MOTION_MEDIA_QUERY,
} from "./use-media-query";

export interface UseScrollIntoViewWhenOptions {
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
  /** Downgrades `behavior: "smooth"` to `"auto"` when `prefers-reduced-motion: reduce` matches. */
  respectReducedMotion?: boolean;
  /** Re-runs `scrollIntoView` when this value changes while `when` stays true. */
  resetKey?: unknown;
}

/**
 * Scrolls a live element into view when `when` is true.
 */
export function useScrollIntoViewWhen(
  element: Element | null | undefined,
  when: boolean,
  options?: UseScrollIntoViewWhenOptions,
): void {
  const block = options?.block;
  const inline = options?.inline;
  const behavior = options?.behavior;
  const respectReducedMotion = options?.respectReducedMotion ?? false;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when || !element) return;

    const resolvedBehavior =
      respectReducedMotion &&
      behavior === "smooth" &&
      matchesMediaQuery(REDUCED_MOTION_MEDIA_QUERY)
        ? "auto"
        : behavior;

    let scrollOptions: ScrollIntoViewOptions | undefined;
    if (
      block !== undefined ||
      inline !== undefined ||
      resolvedBehavior !== undefined
    ) {
      scrollOptions = {};
      if (block !== undefined) scrollOptions.block = block;
      if (inline !== undefined) scrollOptions.inline = inline;
      if (resolvedBehavior !== undefined) {
        scrollOptions.behavior = resolvedBehavior;
      }
    }

    if (scrollOptions === undefined) {
      element.scrollIntoView();
    } else {
      element.scrollIntoView(scrollOptions);
    }
  }, [element, when, block, inline, behavior, respectReducedMotion, resetKey]);
}
