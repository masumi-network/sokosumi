import { useCallback, useEffect, useRef, useState } from "react";

import { JUMP_TO_LATEST_PX, NEAR_BOTTOM_PX } from "./constants";
import type { Message } from "./types";

interface UseChatScrollOptions {
  messages: Message[];
  isReplying: boolean;
  streamingId: string | null;
  /**
   * True when the scroller shows WelcomeBlock instead of ChatTimeline.
   * Used only to re-attach the content ResizeObserver when that child swaps.
   */
  isEmpty: boolean;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function useChatScroll({
  messages,
  isReplying,
  streamingId,
  isEmpty,
}: UseChatScrollOptions) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const prevMessagesLengthRef = useRef(0);
  // Sticky flag measured *before* content grows — measuring after a large
  // ResizeObserver jump can make the user look scrolled-up even when they
  // were pinned, which would drop follow for that frame.
  const stickToBottomRef = useRef(true);

  // Auto-scroll to bottom on new messages (or when typing indicator flips on).
  // Two exceptions:
  //  1. First-ever message lands (0 → 1) — that's the welcome, user should
  //     start reading from the top of it, not jumped to the bottom.
  //  2. Initial mount with history already populated — `requestAnimationFrame`
  //     still scrolls so returning users land at the latest message, which is
  //     the standard chat behaviour.
  useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (prevLen === 0 && messages.length === 1) return;

    const el = scrollerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length, isReplying]);

  // Follow the answer as it streams in — but only if the user is already
  // sticky near the bottom, so scrolling up to re-read isn't hijacked.
  const streamingContentLength = streamingId
    ? (messages.find((m) => m.id === streamingId)?.content.length ?? 0)
    : 0;
  useEffect(() => {
    if (!streamingId) return;
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingId, streamingContentLength]);

  // Follow height changes the two effects above can't see: the reasoning
  // line and tool-progress chips appear and grow during a turn without
  // adding a message or lengthening the streamed text, and at turn end they
  // collapse back into the message's step disclosure (content shrinks).
  // A ResizeObserver on the scroller's content keeps the viewport pinned
  // while the sticky flag is set. Re-attached when WelcomeBlock ↔
  // ChatTimeline swaps (`isEmpty`).
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
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const distance = distanceFromBottom(el);
      stickToBottomRef.current = distance < NEAR_BOTTOM_PX;
      setAtBottom(distance < JUMP_TO_LATEST_PX);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
      setAtBottom(true);
    }
  }, []);

  return {
    scrollerRef,
    atBottom,
    handleScrollerScroll,
    scrollToBottom,
  };
}
