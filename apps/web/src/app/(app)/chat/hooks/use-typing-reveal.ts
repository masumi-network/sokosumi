"use client";

import { useEffect, useRef, useState } from "react";

const MS_PER_CHAR = 3;

export function useTypingReveal(text: string): string {
  const [revealedLength, setRevealedLength] = useState(0);
  const prevTextRef = useRef("");
  const targetRef = useRef(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (text === prevTextRef.current) return;
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    if (prev.length > 0 && text.startsWith(prev)) {
      return;
    }
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    queueMicrotask(() => setRevealedLength(0));
  }, [text]);

  useEffect(() => {
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    const target = text.length;
    targetRef.current = target;
    if (target === 0) return;
    if (revealedLength >= target) return;

    intervalIdRef.current = setInterval(() => {
      setRevealedLength((len) => {
        const t = targetRef.current;
        if (len >= t) {
          if (intervalIdRef.current) {
            clearInterval(intervalIdRef.current);
            intervalIdRef.current = null;
          }
          return len;
        }
        return len + 1;
      });
    }, MS_PER_CHAR);

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
    // Only re-run when text length changes; revealedLength is updated by the interval
  }, [text.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return text.slice(0, revealedLength);
}
