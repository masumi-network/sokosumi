"use client";

import { useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 100;

export function useScrollToBottom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll() {
      const el = containerRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
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
