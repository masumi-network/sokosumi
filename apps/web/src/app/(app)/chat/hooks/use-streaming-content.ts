"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const CHARS_PER_SECOND = 128;
const CATCH_UP_THRESHOLD = 6;

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

export function useStreamingContent(
  content: string,
  isStreaming: boolean,
): string {
  const visibilityState = useSyncExternalStore(
    subscribeVisibility,
    getDocumentVisibilityState,
    (): DocumentVisibilityState => "visible",
  );

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

  const revealToTargetLength = useCallback((targetLength: number) => {
    if (revealedLengthRef.current >= targetLength) return;
    revealedLengthRef.current = targetLength;
    setRevealedLength(targetLength);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingCharsRef.current = 0;
    lastTimeRef.current = null;
  }, []);

  useEffect(() => {
    if (!isDocumentHidden()) return;
    const target = contentLengthRef.current;
    if (revealedLengthRef.current >= target) return;
    queueMicrotask(() => revealToTargetLength(target));
  }, [content.length, revealToTargetLength]);

  useEffect(() => {
    function flushIfHidden() {
      if (!isDocumentHidden()) return;
      revealToTargetLength(contentLengthRef.current);
    }
    document.addEventListener("visibilitychange", flushIfHidden);
    flushIfHidden();
    return () =>
      document.removeEventListener("visibilitychange", flushIfHidden);
  }, [revealToTargetLength]);

  useEffect(() => {
    const hasMoreToReveal =
      contentLengthRef.current > revealedLengthRef.current;
    const shouldRun =
      visibilityState !== "hidden" &&
      hasMoreToReveal &&
      (isStreaming || revealedLengthRef.current > 0) &&
      rafIdRef.current === null;
    if (!shouldRun) return;

    let didSetAnimated = false;
    function loop(now: number) {
      if (isDocumentHidden()) {
        const targetLength = contentLengthRef.current;
        if (revealedLengthRef.current < targetLength) {
          revealedLengthRef.current = targetLength;
          setRevealedLength(targetLength);
        }
        pendingCharsRef.current = 0;
        lastTimeRef.current = null;
        rafIdRef.current = null;
        return;
      }
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

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isStreaming, content.length, visibilityState]);

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
