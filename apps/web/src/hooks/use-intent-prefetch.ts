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

// Where the cursor last was. Off the page until it first moves, and again
// once it leaves the page. A cursor with a button down points at nothing.
const OFF_PAGE = -1;
let cursorX = OFF_PAGE;
let cursorY = OFF_PAGE;

function cursorLeft() {
  cursorX = OFF_PAGE;
  cursorY = OFF_PAGE;
}

// The listeners feed this module's own state, so they follow this module, not
// the library's singleton: a test worker reloads this module per file while
// the library stays initialised. They stay on while an element is registered,
// so a module nothing uses any more leaves none behind.
let registered = 0;

function pointerMoved(event: PointerEvent) {
  if (event.buttons !== 0) {
    cursorLeft();
    unsettle();
    return;
  }
  cursorX = event.clientX;
  cursorY = event.clientY;
}

const CAPTURE = { capture: true, passive: true } as const;

// With scroll prediction off the library still fires each element that
// scrolls under a resting cursor. And it predicts from geometry alone, so
// a drag fires each element it crosses. Neither is the reader heading for it.
function listen() {
  document.addEventListener("scroll", unsettle, CAPTURE);
  document.addEventListener("pointermove", pointerMoved, CAPTURE);
  document.documentElement.addEventListener("pointerleave", cursorLeft);
}

function stopListening() {
  document.removeEventListener("scroll", unsettle, CAPTURE);
  document.removeEventListener("pointermove", pointerMoved, CAPTURE);
  document.documentElement.removeEventListener("pointerleave", cursorLeft);
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
 * close by, or when a touch starts on it. It also runs for the element a
 * scroll leaves under the cursor: where the reader stops is where they look.
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
      const whenSettled = () => {
        const wait = unsettledAt + UNSETTLED_MS - Date.now();
        if (wait > 0) {
          retry = setTimeout(whenSettled, wait);
          return;
        }
        if (element.contains(document.elementFromPoint(cursorX, cursorY))) {
          latest.current();
          return;
        }
        // The library now holds the element back for `reactivateAfter`.
        // Nothing was prefetched, so let it predict again.
        manager.reactivate(element);
      };
      const { unregister } = manager.register({
        element,
        callback: () => {
          if (Date.now() - unsettledAt >= UNSETTLED_MS) {
            latest.current();
            return;
          }
          // A long scroll outlasts `reactivateAfter`, so the element can fire
          // again while it still waits.
          clearTimeout(retry);
          retry = setTimeout(whenSettled, UNSETTLED_MS);
        },
        reactivateAfter,
      });
      if (registered++ === 0) listen();
      return () => {
        clearTimeout(retry);
        unregister();
        if (--registered === 0) stopListening();
      };
    },
    [enabled, reactivateAfter],
  );
}
