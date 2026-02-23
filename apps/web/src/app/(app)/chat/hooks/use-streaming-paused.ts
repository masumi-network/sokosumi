"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_PAUSE_DELAY_MS = 800;

/**
 * Returns true when the assistant is streaming but no new content has arrived
 * for a short period (e.g. backend is thinking/processing). Hides as soon as
 * content length increases again.
 */
export function useStreamingPaused(
  content: string,
  isStreaming: boolean,
  delayMs: number = DEFAULT_PAUSE_DELAY_MS,
): boolean {
  const [isPaused, setIsPaused] = useState(false);
  const lastLengthRef = useRef(content.length);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsPaused(false);
      lastLengthRef.current = content.length;
      return;
    }

    const currentLength = content.length;
    if (currentLength !== lastLengthRef.current) {
      lastLengthRef.current = currentLength;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsPaused(false);
    }

    if (currentLength === 0) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsPaused(true);
    }, delayMs);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [content.length, isStreaming, delayMs]);

  return isPaused;
}
