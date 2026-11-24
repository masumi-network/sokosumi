"use client";

import {
  type RefObject,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

interface ScrollMarginStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  getServerSnapshot: () => number;
  set: (next: number) => void;
}

/**
 * Opaque slot connecting `useTranscriptViewportScrollMarginState` (read during
 * render for `useVirtualizer`) to `useTranscriptViewportScrollMargin` (measured
 * in a layout effect after `useVirtualizer` updates container height).
 */
export interface TranscriptScrollMarginSlot {
  readonly __brand: "TranscriptScrollMarginSlot";
}

const stores = new WeakMap<TranscriptScrollMarginSlot, ScrollMarginStore>();

function createScrollMarginSlot(): TranscriptScrollMarginSlot {
  let value = 0;
  const listeners = new Set<() => void>();
  const slot = {} as TranscriptScrollMarginSlot;
  stores.set(slot, {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return value;
    },
    getServerSnapshot() {
      return 0;
    },
    set(next) {
      if (next === value) {
        return;
      }
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
  });
  return slot;
}

function readStore(slot: TranscriptScrollMarginSlot): ScrollMarginStore {
  const store = stores.get(slot);
  if (!store) {
    throw new Error(
      "useTranscriptViewportScrollMargin requires a slot from useTranscriptViewportScrollMarginState",
    );
  }
  return store;
}

/**
 * Holds `TranscriptViewport`'s measured `scrollMargin` so `useVirtualizer` can
 * read it during render while `useTranscriptViewportScrollMargin` measures it
 * in a layout effect after `useVirtualizer` has updated container height.
 */
export function useTranscriptViewportScrollMarginState(): readonly [
  number,
  TranscriptScrollMarginSlot,
] {
  const [slot] = useState(createScrollMarginSlot);
  const store = readStore(slot);
  const scrollMargin = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return [scrollMargin, slot] as const;
}

/**
 * Tracks the vertical offset of `TranscriptViewport`'s list container inside
 * its scroller in a no-deps layout effect so the virtualizer aligns its end
 * with the scroller's end as a short list grows toward the scroller's height.
 * Call after `useVirtualizer` and before `useTranscriptViewportInitialLanding`.
 */
export function useTranscriptViewportScrollMargin(
  scroller: HTMLElement | null,
  containerRef: RefObject<HTMLDivElement | null>,
  slot: TranscriptScrollMarginSlot,
): void {
  const store = readStore(slot);

  // Every render: the container moves whenever a short list grows toward
  // the scroller's height, and the state guard makes a settled margin free.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!scroller || !container) {
      return;
    }
    const margin = Math.round(
      container.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
    );
    store.set(margin);
  });
}
