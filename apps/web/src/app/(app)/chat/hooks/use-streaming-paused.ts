"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_PAUSE_DELAY_MS = 800;

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
      queueMicrotask(() => setIsPaused(false));
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
      queueMicrotask(() => setIsPaused(false));
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
