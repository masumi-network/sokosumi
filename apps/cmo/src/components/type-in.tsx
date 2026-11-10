"use client";

import { useEffect, useState } from "react";

/** How long new text takes to type in, whatever its length. */
export const TYPE_IN_MS = 1_000;
const TICK_MS = 30;

export const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Types text in where Cuso writes it. Text the screen mounted with shows at
 * once, so a reload never replays; a change types in about a second, only
 * the part after what was already shown. Under reduced motion it shows at
 * once. The one place CMO animates text.
 */
export function useTypeIn(text: string): { shown: string; typing: boolean } {
  const [state, setState] = useState({ target: text, shown: text });
  // Set while rendering, so the old text never flashes before typing starts.
  if (state.target !== text) {
    const kept = text.startsWith(state.shown) ? state.shown.length : 0;
    setState({
      target: text,
      shown: reducedMotion() ? text : text.slice(0, kept),
    });
  }

  const { target } = state;
  const from = state.shown.length;
  // Starts once per new target, from what it showed then.
  useEffect(() => {
    if (from >= target.length) return;
    const step = Math.max(1, Math.ceil(target.length / (TYPE_IN_MS / TICK_MS)));
    let at = from;
    const timer = window.setInterval(() => {
      at = Math.min(target.length, at + step);
      setState((current) =>
        current.target === target
          ? { target, shown: target.slice(0, at) }
          : current,
      );
      if (at === target.length) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [target]);

  const shown = state.target === text ? state.shown : text;
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
