"use client";

import { useEffect, useRef, useState } from "react";

const MS_PER_CHAR = 3;

export function useTypingReveal(text: string): string {
  const [revealedLength, setRevealedLength] = useState(0);
  const prevTextRef = useRef("");
  const targetRef = useRef(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }

    const prev = prevTextRef.current;
    const textChanged = text !== prev;

    if (textChanged) {
      prevTextRef.current = text;
      const isExtension = prev.length > 0 && text.startsWith(prev);
      if (!isExtension) {
        queueMicrotask(() => {
          setRevealedLength(0);
        });
      }
    }

    const target = text.length;
    targetRef.current = target;
    if (target === 0) {
      return () => {
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }
      };
    }

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
  }, [text]);

  return text.slice(0, revealedLength);
}
