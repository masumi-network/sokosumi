"use client";

import { useSyncExternalStore } from "react";

import {
  EMOJI_PICKER_CHROME_ESTIMATE_PX,
  EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  resolveEmojiPickerMaxHeightPx,
} from "@/lib/utils/emoji-picker-max-height";

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

function readVisualViewportHeightPx(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * Max height (px) for the emoji picker shell, tracking visualViewport for
 * soft-keyboard shrink.
 */
export function useEmojiPickerMaxHeight(
  chromePx: number = EMOJI_PICKER_CHROME_ESTIMATE_PX,
): number {
  const visualViewportHeightPx = useSyncExternalStore(
    subscribe,
    readVisualViewportHeightPx,
    () => EMOJI_PICKER_MAX_HEIGHT_CAP_PX + chromePx,
  );
  return resolveEmojiPickerMaxHeightPx({
    visualViewportHeightPx,
    chromePx,
  });
}
