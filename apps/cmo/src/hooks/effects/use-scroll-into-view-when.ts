"use client";

import { useEffect } from "react";

export interface UseScrollIntoViewWhenOptions {
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
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
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when || !element) return;

    let scrollOptions: ScrollIntoViewOptions | undefined;
    if (block !== undefined || inline !== undefined || behavior !== undefined) {
      scrollOptions = {};
      if (block !== undefined) scrollOptions.block = block;
      if (inline !== undefined) scrollOptions.inline = inline;
      if (behavior !== undefined) scrollOptions.behavior = behavior;
    }

    if (scrollOptions === undefined) {
      element.scrollIntoView();
    } else {
      element.scrollIntoView(scrollOptions);
    }
  }, [element, when, block, inline, behavior, resetKey]);
}
