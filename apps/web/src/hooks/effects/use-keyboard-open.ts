"use client";

import { useSyncExternalStore } from "react";

import { readVisualViewportKeyboardOpen } from "@/lib/utils/visual-viewport-keyboard";

function subscribe(onStoreChange: () => void): () => void {
  const visualViewport = window.visualViewport;
  // iOS: vv resize/scroll when the OSK opens; focusin/out for editable gate.
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
 * True when an editable is focused and the soft keyboard is likely open.
 * Autofocus without OSK (iOS `focusOnMount`) stays false so safe-area pb remains.
 */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    readVisualViewportKeyboardOpen,
    () => false,
  );
}
