"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

export type ScrollIntoViewTarget =
  | RefObject<Element | null>
  | (() => Element | null | undefined);

export interface UseScrollIntoViewWhenOptions {
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
  /** Re-runs `scrollIntoView` when this value changes while `when` stays true. */
  resetKey?: unknown;
}

/**
 * Scrolls the resolved element into view when `when` is true, reading the ref
 * or getter at effect time so only trigger changes fire a scroll.
 */
export function useScrollIntoViewWhen(
  target: ScrollIntoViewTarget,
  when: boolean,
  options?: UseScrollIntoViewWhenOptions,
): void {
  const getTarget = useEffectEvent(() =>
    typeof target === "function" ? target() : target.current,
  );
  const block = options?.block;
  const inline = options?.inline;
  const behavior = options?.behavior;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when) return;

    const element = getTarget();
    if (!element) return;

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
  }, [when, block, inline, behavior, resetKey]);
}
