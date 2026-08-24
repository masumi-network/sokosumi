import { useCallback, useEffect, useRef, useState } from "react";

/** Within this distance of the bottom, content growth still pins the view. */
const NEAR_BOTTOM_PX = 200;
/** Tighter distance for showing the "jump to latest" control. */
const JUMP_TO_LATEST_PX = 80;

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * Sticky-to-bottom scrolling for the timeline. New turns jump to the bottom;
 * progress chips growing mid-turn keep the view pinned only while the user is
 * already near the bottom, so scrolling up to re-read isn't hijacked.
 */
export function useChatScroll({
  rowCount,
  isEmpty,
}: {
  rowCount: number;
  isEmpty: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [rowCount]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const content = el.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isEmpty]);

  const handleScrollerScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const distance = distanceFromBottom(event.currentTarget);
      stickToBottomRef.current = distance < NEAR_BOTTOM_PX;
      setAtBottom(distance < JUMP_TO_LATEST_PX);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setAtBottom(true);
  }, []);

  return { scrollerRef, atBottom, handleScrollerScroll, scrollToBottom };
}
