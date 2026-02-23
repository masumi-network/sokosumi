"use client";

import { useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 100;

/**
 * Provides a scrollable container ref and optional isAtBottom state.
 * No automatic scrolling — avoids scroll jump glitches when sending.
 */
export function useScrollToBottom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll() {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom =
        scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD_PX;
      setIsAtBottom(atBottom);
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  return {
    containerRef,
    endRef,
    isAtBottom,
  };
}
