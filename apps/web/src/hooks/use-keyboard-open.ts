"use client";

import { useSyncExternalStore } from "react";

import { readVisualViewportKeyboardOpen } from "@/lib/utils/visual-viewport-keyboard";

function subscribe(onStoreChange: () => void): () => void {
  const visualViewport = window.visualViewport;
  window.addEventListener("resize", onStoreChange);
  visualViewport?.addEventListener("resize", onStoreChange);
  visualViewport?.addEventListener("scroll", onStoreChange);
  return () => {
    window.removeEventListener("resize", onStoreChange);
    visualViewport?.removeEventListener("resize", onStoreChange);
    visualViewport?.removeEventListener("scroll", onStoreChange);
  };
}

/**
 * True when the soft keyboard is likely open (visual vs layout viewport).
 * SSR / missing visualViewport → false.
 */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    readVisualViewportKeyboardOpen,
    () => false,
  );
}
