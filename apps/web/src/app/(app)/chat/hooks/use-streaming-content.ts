"use client";

import { useEffect, useRef, useState } from "react";

const CHARS_PER_SECOND = 128;
const CATCH_UP_THRESHOLD = 6;

export function useStreamingContent(
  content: string,
  isStreaming: boolean,
): string {
  const [revealedLength, setRevealedLength] = useState(0);
  const contentLengthRef = useRef(content.length);
  const lastTimeRef = useRef<number | null>(null);
  const pendingCharsRef = useRef(0);
  const isStreamingRef = useRef(isStreaming);
  const revealedLengthRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Sync refs in effect so we don't read/write refs during render (React rule)
  useEffect(() => {
    contentLengthRef.current = content.length;
    isStreamingRef.current = isStreaming;
    revealedLengthRef.current = revealedLength;
  }, [content.length, isStreaming, revealedLength]);

  // When content shrinks (e.g. new message), reset revealed length
  if (content.length < revealedLength) {
    setRevealedLength(content.length);
  }

  // Start typewriter when streaming begins; loop keeps running after stream ends
  // until all text is revealed (never cancel on isStreaming false)
  useEffect(() => {
    if (!isStreaming) return;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    function loop(now: number) {
      const targetLength = contentLengthRef.current;
      const streamEnded = !isStreamingRef.current;

      if (streamEnded && revealedLengthRef.current >= targetLength) {
        rafIdRef.current = null;
        return;
      }

      const lastTime = lastTimeRef.current;
      lastTimeRef.current = now;
      const elapsedMs = lastTime !== null ? now - lastTime : 0;
      pendingCharsRef.current += (elapsedMs / 1000) * CHARS_PER_SECOND;

      setRevealedLength((current) => {
        if (current >= targetLength) {
          pendingCharsRef.current = 0;
          revealedLengthRef.current = current;
          return current;
        }
        const remaining = targetLength - current;
        const toAdd = Math.min(
          remaining,
          remaining <= CATCH_UP_THRESHOLD
            ? remaining
            : Math.floor(pendingCharsRef.current),
        );
        if (toAdd > 0) {
          pendingCharsRef.current -= toAdd;
          const next = current + toAdd;
          revealedLengthRef.current = next;
          return next;
        }
        revealedLengthRef.current = current;
        return current;
      });

      rafIdRef.current = requestAnimationFrame(loop);
    }

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      // Intentionally do not cancel when isStreaming becomes false so
      // the animation continues until the end
    };
  }, [isStreaming]);

  // Cancel loop only on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Completed message that was never streamed: show full content
  if (!isStreaming && revealedLength === 0 && content.length > 0) {
    return content;
  }
  // Otherwise enforce typewriter until the end (streaming or catching up)
  return content.slice(0, revealedLength);
}
