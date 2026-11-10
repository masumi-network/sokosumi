"use client";

import { useEffect, useRef, useState } from "react";

/** How long new text takes to type in, whatever its length. */
export const TYPE_IN_MS = 1_000;
const TICK_MS = 30;

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Types text in where Cuso writes it. Text the screen mounted with shows at
 * once, so a reload never replays; a change types in about a second, only
 * the part after what was already shown. Under reduced motion it shows at
 * once. The one place CMO animates text.
 */
export function useTypeIn(text: string): { shown: string; typing: boolean } {
  const seen = useRef(text);
  const [shown, setShown] = useState(text);

  useEffect(() => {
    const before = seen.current;
    seen.current = text;
    if (text === before) return;
    const kept = text.startsWith(before) ? before.length : 0;
    if (reducedMotion() || kept === text.length) {
      setShown(text);
      return;
    }
    const step = Math.max(
      1,
      Math.ceil((text.length - kept) / (TYPE_IN_MS / TICK_MS)),
    );
    let at = kept;
    setShown(text.slice(0, at));
    const timer = window.setInterval(() => {
      at = Math.min(text.length, at + step);
      setShown(text.slice(0, at));
      if (at === text.length) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [text]);

  return { shown, typing: shown !== text };
}

/**
 * Text that types in with a caret. Screen readers get the whole text at once,
 * never a letter at a time.
 */
export function TypeIn({ text }: { text: string }) {
  const { shown, typing } = useTypeIn(text);
  if (!typing) return text;
  return (
    <>
      <span aria-hidden="true">
        {shown}
        <span className="type-caret" />
      </span>
      <span className="ob-sr">{text}</span>
    </>
  );
}

/** The pause between two pieces landing. */
export const LAND_MS = 450;

/**
 * A count that climbs one at a time to its new value, so pieces a poll
 * brings together still land one by one. The value it mounts with, a drop,
 * and every change under reduced motion show at once.
 */
export function useLanding(count: number): number {
  const [shown, setShown] = useState(count);
  useEffect(() => {
    if (count <= shown || reducedMotion()) {
      if (count !== shown) setShown(count);
      return;
    }
    const timer = window.setTimeout(() => setShown(shown + 1), LAND_MS);
    return () => window.clearTimeout(timer);
  }, [count, shown]);
  return shown;
}
