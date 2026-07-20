import { useCallback, useEffect, useRef, useState } from "react";

import type { Message } from "./types";

interface UseChatScrollOptions {
  messages: Message[];
  isReplying: boolean;
  streamingId: string | null;
}

export function useChatScroll({
  messages,
  isReplying,
  streamingId,
}: UseChatScrollOptions) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const prevMessagesLengthRef = useRef(0);

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
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length, isReplying]);

  // Follow the answer as it streams in — but only if the user is already near
  // the bottom, so scrolling up to re-read isn't hijacked mid-stream.
  const streamingContentLength = streamingId
    ? (messages.find((m) => m.id === streamingId)?.content.length ?? 0)
    : 0;
  useEffect(() => {
    if (!streamingId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [streamingId, streamingContentLength]);

  const handleScrollerScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
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
