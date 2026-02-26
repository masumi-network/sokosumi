"use client";

import { useEffect, useRef, useState } from "react";

const CHARS_PER_SECOND = 128;
const CATCH_UP_THRESHOLD = 6;

export function useStreamingContent(
  content: string,
  isStreaming: boolean,
): string {
  const [revealedLength, setRevealedLength] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const contentLengthRef = useRef(content.length);
  const lastTimeRef = useRef<number | null>(null);
  const pendingCharsRef = useRef(0);
  const isStreamingRef = useRef(isStreaming);
  const revealedLengthRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    contentLengthRef.current = content.length;
    isStreamingRef.current = isStreaming;
    revealedLengthRef.current = revealedLength;
  }, [content.length, isStreaming, revealedLength]);

  useEffect(() => {
    if (content.length < revealedLength) {
      queueMicrotask(() => {
        setRevealedLength(content.length);
        setHasAnimated(false);
      });
    }
  }, [content.length, revealedLength]);

  useEffect(() => {
    const hasMoreToReveal =
      contentLengthRef.current > revealedLengthRef.current;
    const shouldRun =
      hasMoreToReveal &&
      (isStreaming || revealedLengthRef.current > 0) &&
      rafIdRef.current === null;
    if (!shouldRun) return;

    let didSetAnimated = false;
    function loop(now: number) {
      if (!didSetAnimated) {
        didSetAnimated = true;
        setHasAnimated(true);
      }
      const targetLength = contentLengthRef.current;
      if (revealedLengthRef.current >= targetLength) {
        lastTimeRef.current = null;
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

    return () => {};
  }, [isStreaming, content.length]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  if (
    !isStreaming &&
    revealedLength === 0 &&
    content.length > 0 &&
    !hasAnimated
  ) {
    return content;
  }
  return content.slice(0, revealedLength);
}
