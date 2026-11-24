"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Tracks the vertical offset of `TranscriptViewport`'s list container inside
 * its scroller in a no-deps layout effect so the virtualizer aligns its end
 * with the scroller's end as a short list grows toward the scroller's height.
 */
export function useTranscriptViewportScrollMargin(
  scroller: HTMLElement | null,
  containerRef: RefObject<HTMLDivElement | null>,
): number {
  const [scrollMargin, setScrollMargin] = useState(0);

  // Every render: the container moves whenever a short list grows toward
  // the scroller's height, and the state guard makes a settled margin free.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!scroller || !container) {
      return;
    }
    const margin = Math.round(
      container.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
    );
    if (margin !== scrollMargin) {
      setScrollMargin(margin);
    }
  });

  return scrollMargin;
}
