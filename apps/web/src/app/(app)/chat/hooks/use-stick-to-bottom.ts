"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Within this distance of the bottom, content resizes still pin the viewport.
 * Wider than a tiny nudge so mid-stream growth does not drop follow.
 */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

interface UseStickToBottomOptions {
  /** Room id (or similar): force pin, scroll to live edge, rebind observers. */
  resetKey?: string | null;
  nearBottomPx?: number;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function useStickToBottom({
  resetKey = null,
  nearBottomPx = STICK_TO_BOTTOM_NEAR_PX,
}: UseStickToBottomOptions = {}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Sticky flag measured on scroll *before* growth. Measuring after a
  // ResizeObserver jump can make a pinned user look scrolled-up for a frame.
  const stickToBottomRef = useRef(true);
  // Search jump: keep the live-edge pin from yanking the viewport back to
  // the newest row while we land on an older hit.
  const suppressPinRef = useRef(false);
  // Last observed scroller scrollHeight so ResizeObserver can recover when a
  // growth-driven scroll event clears the sticky flag mid-frame.
  const lastScrollHeightRef = useRef(0);
  // Pixel min-height so short transcripts can justify-end in the scroller
  // (kept after native overflow swap; was required for Radix display:table).
  const [contentMinHeight, setContentMinHeight] = useState<number>();

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    suppressPinRef.current = false;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
  }, []);

  const suppressStickToBottom = useCallback(() => {
    stickToBottomRef.current = false;
    suppressPinRef.current = true;
  }, []);

  /**
   * Own send: always reveal the new bubble, even if typing/composer resize
   * cleared the sticky flag. Immediate + rAF so late layout still pins.
   */
  const pinToBottomAfterOwnSend = useCallback(() => {
    scrollToBottom();
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [scrollToBottom]);
  const scrollToBottomIfPinned = useCallback(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    suppressPinRef.current = false;
    stickToBottomRef.current = true;
    const frame = requestAnimationFrame(() => {
      scrollToBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [resetKey, scrollToBottom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    lastScrollHeightRef.current = scroller.scrollHeight;

    const observer = new ResizeObserver(() => {
      const previousHeight = lastScrollHeightRef.current;
      const nextHeight = scroller.scrollHeight;
      const growth = nextHeight - previousHeight;
      lastScrollHeightRef.current = nextHeight;

      if (suppressPinRef.current) {
        return;
      }

      if (stickToBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }

      // Content growth can fire `scroll` before this callback. Distance then
      // looks large and clears the sticky flag even though the user was at the
      // pre-growth bottom. Recover from that false unpin.
      if (growth > 0) {
        const distanceBeforeGrowth = distanceFromBottom(scroller) - growth;
        if (distanceBeforeGrowth < nearBottomPx) {
          scroller.scrollTop = scroller.scrollHeight;
          stickToBottomRef.current = true;
        }
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [nearBottomPx, resetKey]);

  // Layout effect: avoid one painted frame with wrong min-height (skeleton
  // / short transcript jumped when useEffect ran after paint).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") {
      return;
    }

    function syncMinHeight() {
      const node = scrollerRef.current;
      if (!node) {
        return;
      }
      setContentMinHeight(node.clientHeight);
    }

    syncMinHeight();
    const observer = new ResizeObserver(syncMinHeight);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [resetKey]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    function handleScroll() {
      const node = scrollerRef.current;
      if (!node) {
        return;
      }
      if (suppressPinRef.current) {
        stickToBottomRef.current = false;
        return;
      }
      stickToBottomRef.current = distanceFromBottom(node) < nearBottomPx;
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [nearBottomPx, resetKey]);

  return {
    scrollerRef,
    contentRef,
    contentMinHeight,
    scrollToBottom,
    pinToBottomAfterOwnSend,
    scrollToBottomIfPinned,
    suppressStickToBottom,
  };
}
