"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 100;
const SCROLL_AFTER_SECTION_MS = 100;
const PROMPT_OFFSET_PX = 80;
const PROMPT_OFFSET_PX_MOBILE = 220;

function getPromptOffsetPx(): number {
  if (typeof window === "undefined") return PROMPT_OFFSET_PX;
  return window.innerWidth < 768 ? PROMPT_OFFSET_PX_MOBILE : PROMPT_OFFSET_PX;
}

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

  const scrollToMax = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const run = () => {
      const offset = getPromptOffsetPx();
      const targetScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight - offset,
      );
      container.scrollTo({
        top: targetScrollTop,
        behavior: "smooth",
      });
    };
    setTimeout(run, SCROLL_AFTER_SECTION_MS);
  }, []);

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToMax,
  };
}
