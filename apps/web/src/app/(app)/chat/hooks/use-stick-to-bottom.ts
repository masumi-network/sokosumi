"use client";

import { useCallback, useEffect, useRef } from "react";

/** Distance from bottom that still counts as "pinned" (Slack-style follow). */
export const STICK_TO_BOTTOM_NEAR_PX = 200;

interface UseStickToBottomOptions {
  /**
   * When this changes (e.g. room id), force pin and scroll to the live edge.
   * Also re-attaches observers after the scroller remounts.
   */
  resetKey?: string | null;
  nearBottomPx?: number;
}

/**
 * Stick the scroll viewport to the bottom while the user is near it.
 * Content growth (reactions, stream text, new rows) re-pins via ResizeObserver
 * without fingerprinting message fields. Scroll away and growth leaves you alone.
 */
export function useStickToBottom({
  resetKey = null,
  nearBottomPx = STICK_TO_BOTTOM_NEAR_PX,
}: UseStickToBottomOptions = {}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Measured on scroll *before* growth. Reading after a ResizeObserver pin
  // can make a pinned user look scrolled-up for one frame.
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
