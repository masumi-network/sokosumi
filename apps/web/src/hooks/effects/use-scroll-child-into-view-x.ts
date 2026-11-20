"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Adjusts `containerRef.current.scrollLeft` just enough to reveal the matched
 * child horizontally without scrolling the vertical page, whenever `trigger`
 * changes.
 */
export function useScrollChildIntoViewX(
  containerRef: RefObject<HTMLElement | null>,
  getChild: () => HTMLElement | null | undefined,
  trigger: unknown,
): void {
  const scrollChild = useEffectEvent(() => {
    const bar = containerRef.current;
    const child = getChild();
    if (!bar || !child) return;

    const outer = bar.getBoundingClientRect();
    const inner = child.getBoundingClientRect();
    if (inner.left < outer.left) {
      bar.scrollLeft -= outer.left - inner.left;
    } else if (inner.right > outer.right) {
      bar.scrollLeft += inner.right - outer.right;
    }
  });

  useEffect(() => {
    void trigger;
    scrollChild();
  }, [trigger]);
}
