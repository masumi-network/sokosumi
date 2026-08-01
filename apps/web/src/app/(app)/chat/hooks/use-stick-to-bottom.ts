"use client";

import { useCallback, useEffect, useRef } from "react";

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

export function useStickToBottom({
  resetKey = null,
  nearBottomPx = STICK_TO_BOTTOM_NEAR_PX,
}: UseStickToBottomOptions = {}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Sticky flag measured on scroll *before* growth. Measuring after a
  // ResizeObserver jump can make a pinned user look scrolled-up for a frame.
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
  }, []);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
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

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(content);
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
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickToBottomRef.current = distance < nearBottomPx;
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [nearBottomPx, resetKey]);

  return {
    scrollerRef,
    contentRef,
    scrollToBottom,
    scrollToBottomIfPinned,
  };
}
