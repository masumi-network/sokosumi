"use client";

import { ForesightManager } from "js.foresight";
import { useCallback, useEffect, useRef } from "react";

/**
 * How long after a scroll, or a move with a mouse button down, a prediction
 * says nothing about where the reader is heading.
 */
const UNSETTLED_MS = 200;

let unsettledAt = Number.NEGATIVE_INFINITY;

function unsettle() {
  unsettledAt = Date.now();
}

function intentManager() {
  if (!ForesightManager.isInitiated) {
    // Two library defaults are off. It would write its own `data-active` onto
    // each element, over the `data-active` the sidebar styles its open row by.
    // And its scroll prediction fires each element ahead of the cursor in the
    // scroll direction, which is a list's worth of prefetches for one wheel turn.
    ForesightManager.initialize({
      setDataAttributes: false,
      enableScrollPrediction: false,
    });
    // With scroll prediction off the library still fires each element that
    // scrolls under a resting cursor. And it predicts from geometry alone, so
    // a drag fires each element it crosses. Neither is the reader heading for it.
    document.addEventListener("scroll", unsettle, {
      capture: true,
      passive: true,
    });
    document.addEventListener(
      "pointermove",
      (event) => {
        if (event.buttons !== 0) unsettle();
      },
      { capture: true, passive: true },
    );
  }
  return ForesightManager.instance;
}

interface IntentPrefetchOptions {
  /** Time in ms after one run before the element can run `prefetch` again. */
  reactivateAfter: number;
  enabled?: boolean;
}

/**
 * Ref for an element the reader may head for. `prefetch` runs ahead of the
 * click: when the cursor's path points at the element, when a Tab stop is
 * close by, or when a touch starts on it.
 */
export function useIntentPrefetch<T extends Element>(
  prefetch: () => void,
  { reactivateAfter, enabled = true }: IntentPrefetchOptions,
) {
  // The element registers once, so it calls whichever `prefetch` is current.
  const latest = useRef(prefetch);
  useEffect(() => {
    latest.current = prefetch;
  });
  return useCallback(
    (element: T | null) => {
      if (!element || !enabled) return;
      const manager = intentManager();
      let retry: ReturnType<typeof setTimeout> | undefined;
      const { unregister } = manager.register({
        element,
        callback: () => {
          if (Date.now() - unsettledAt >= UNSETTLED_MS) {
            latest.current();
            return;
          }
          // The library now holds the element back for `reactivateAfter`.
          // Nothing was prefetched, so let it predict again once things settle.
          retry = setTimeout(() => manager.reactivate(element), UNSETTLED_MS);
        },
        reactivateAfter,
      });
      return () => {
        clearTimeout(retry);
        unregister();
      };
    },
    [enabled, reactivateAfter],
  );
}
