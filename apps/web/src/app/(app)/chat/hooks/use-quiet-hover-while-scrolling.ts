"use client";

import { useEffect } from "react";

/**
 * Marks a transcript scroller for as long as a scroll is running. Scrolling
 * drags a stationary pointer across row after row, and every row it crosses
 * lights up its hover chrome on the way past. globals.css holds the hover
 * action pill back while the mark is on, so only the row the pointer is left
 * sitting on lights up.
 */
export const CHAT_SCROLLING_ATTRIBUTE = "data-chat-scrolling";

/**
 * Momentum scrolling arrives in bursts with gaps between them. Anything much
 * shorter than this lets the pill flash through a gap.
 */
const SCROLL_SETTLE_MS = 150;

export function useQuietHoverWhileScrolling(
  scroller: HTMLElement | null,
): void {
  useEffect(() => {
    if (scroller === null) {
      return;
    }
    const node = scroller;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    function handleScroll() {
      node.setAttribute(CHAT_SCROLLING_ATTRIBUTE, "");
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        node.removeAttribute(CHAT_SCROLLING_ATTRIBUTE);
      }, SCROLL_SETTLE_MS);
    }
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(settleTimer);
      node.removeEventListener("scroll", handleScroll);
      node.removeAttribute(CHAT_SCROLLING_ATTRIBUTE);
    };
  }, [scroller]);
}
