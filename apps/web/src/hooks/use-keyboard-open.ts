"use client";

import { useSyncExternalStore } from "react";

import { readVisualViewportKeyboardOpen } from "@/lib/utils/visual-viewport-keyboard";

function subscribe(onStoreChange: () => void): () => void {
  const visualViewport = window.visualViewport;
  // iOS keyboard open often fires vv resize/scroll only (not window resize).
  // focusin/out: re-check after focus settles; geometry may lag a frame.
  window.addEventListener("resize", onStoreChange);
  window.addEventListener("orientationchange", onStoreChange);
  document.addEventListener("focusin", onStoreChange);
  document.addEventListener("focusout", onStoreChange);
  visualViewport?.addEventListener("resize", onStoreChange);
  visualViewport?.addEventListener("scroll", onStoreChange);
  return () => {
    window.removeEventListener("resize", onStoreChange);
    window.removeEventListener("orientationchange", onStoreChange);
    document.removeEventListener("focusin", onStoreChange);
    document.removeEventListener("focusout", onStoreChange);
    visualViewport?.removeEventListener("resize", onStoreChange);
    visualViewport?.removeEventListener("scroll", onStoreChange);
  };
}

/**
 * True when the soft keyboard is likely open (visual vs layout viewport).
 * SSR / missing visualViewport → false unless layout shrunk vs baseline.
 */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    readVisualViewportKeyboardOpen,
    () => false,
  );
}
