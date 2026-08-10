"use client";

import { useSyncExternalStore } from "react";

import { DYNAMIC_TYPE_DEFAULT_ROOT_PX } from "@/lib/utils/dynamic-type";
import {
  EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
  estimateEmojiPickerChromePx,
  estimateEmojiPickerMinGridPx,
  readRootFontSizePx,
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

function resolveMaxHeightPx(chromePx?: number): number {
  const visualViewportHeightPx =
    window.visualViewport?.height ?? window.innerHeight;
  const rootFontSizePx = readRootFontSizePx();
  return resolveEmojiPickerMaxHeightPx({
    visualViewportHeightPx,
    chromePx: chromePx ?? estimateEmojiPickerChromePx(rootFontSizePx),
    minGridPx: estimateEmojiPickerMinGridPx(rootFontSizePx),
  });
}

function resolveServerMaxHeightPx(chromePx?: number): number {
  return resolveEmojiPickerMaxHeightPx({
    visualViewportHeightPx: EMOJI_PICKER_MAX_HEIGHT_CAP_PX,
    chromePx:
      chromePx ?? estimateEmojiPickerChromePx(DYNAMIC_TYPE_DEFAULT_ROOT_PX),
    minGridPx: estimateEmojiPickerMinGridPx(DYNAMIC_TYPE_DEFAULT_ROOT_PX),
  });
}

/**
 * Max height (px) for the emoji picker shell, tracking visualViewport for
 * soft-keyboard shrink. Floor uses rem-scaled chrome + min grid so Dynamic
 * Type does not under-estimate and clip via overflow-hidden.
 */
export function useEmojiPickerMaxHeight(chromePx?: number): number {
  return useSyncExternalStore(
    subscribe,
    () => resolveMaxHeightPx(chromePx),
    () => resolveServerMaxHeightPx(chromePx),
  );
}
