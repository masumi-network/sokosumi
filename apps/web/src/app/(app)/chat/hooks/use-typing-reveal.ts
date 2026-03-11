"use client";

import { useEffect, useRef, useState } from "react";

const MS_PER_CHAR = 3;

export function useTypingReveal(text: string): string {
  const [revealedLength, setRevealedLength] = useState(0);
  const prevTextRef = useRef("");
  const targetRef = useRef(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  targetRef.current = text.length;

  useEffect(() => {
    if (text === prevTextRef.current) return;
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    if (prev.length > 0 && text.startsWith(prev)) {
      return;
    }
    setRevealedLength(0);
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, [text]);

  useEffect(() => {
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    const target = text.length;
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
  }, [text.length]);

  return text.slice(0, revealedLength);
}
