"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const MS_PER_CHAR = 3;

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function subscribeVisibility(callback: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function getDocumentVisibilityState(): DocumentVisibilityState {
  return typeof document !== "undefined" ? document.visibilityState : "visible";
}

export function useTypingReveal(text: string): string {
  const visibilityState = useSyncExternalStore(
    subscribeVisibility,
    getDocumentVisibilityState,
    (): DocumentVisibilityState => "visible",
  );

  const [revealedLength, setRevealedLength] = useState(0);
  const prevTextRef = useRef("");
  const targetRef = useRef(0);
  const revealedLengthRef = useRef(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  targetRef.current = text.length;
  revealedLengthRef.current = revealedLength;

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

    if (isDocumentHidden()) {
      setRevealedLength(text.length);
      return;
    }

    const target = text.length;
    if (target === 0) return;
    if (revealedLengthRef.current >= target) return;

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
  }, [text.length, visibilityState]);

  return text.slice(0, revealedLength);
}
