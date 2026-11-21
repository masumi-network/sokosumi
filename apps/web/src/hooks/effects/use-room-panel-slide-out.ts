"use client";

import { usePresence } from "motion/react";
import { type RefObject, useEffect, useEffectEvent } from "react";

import { usePrefersReducedMotion } from "./use-media-query";

/** The enter pairing dialogs use (`duration-200 ease-out-strong`). */
export const ROOM_PANEL_SLIDE_MS = 200;
const SLIDE_EASING_TOKEN = "--ease-out-strong";

export function readRoomPanelSlideEasing(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(SLIDE_EASING_TOKEN)
      .trim() || "ease-out"
  );
}

/** How far a running slide has moved `node` from its layout position. */
export function readRoomPanelPaintedOffset(node: HTMLElement): number {
  return new DOMMatrix(getComputedStyle(node).transform).m41;
}

/**
 * Slides a closing side panel out past the pane's edge, then lets
 * `AnimatePresence` unmount it. Its slot leaves the flow as soon as it closes
 * (`isPresent` false), so `useRoomPanelSlide` sees the section widen in the
 * same frame and everything moves together.
 */
export function useRoomPanelSlideOut(
  panelRef: RefObject<HTMLDivElement | null>,
): boolean {
  const [isPresent, safeToRemove] = usePresence();
  const reduceMotion = usePrefersReducedMotion();
  // `safeToRemove` is new on every render. As an effect dependency, each render
  // during the slide would restart it, and a streaming room would never let the
  // panel unmount.
  const removePanel = useEffectEvent(() => safeToRemove?.());
  const shouldReduceMotion = useEffectEvent(() => reduceMotion);

  // Not a layout effect: `AnimatePresence` registers the exit in its own layout
  // effect, after this child's, and ignores a removal that comes before it.
  useEffect(() => {
    if (isPresent) return;
    const panel = panelRef.current;
    // Below `lg` the slot is `display: contents` and has no box: the panel
    // overlays the room, so it just goes.
    if (!panel || panel.offsetWidth === 0 || shouldReduceMotion()) {
      removePanel();
      return;
    }
    // Start from where it is painted, so closing mid-slide does not jump.
    const exit = panel.animate(
      [
        { transform: `translateX(${readRoomPanelPaintedOffset(panel)}px)` },
        { transform: "translateX(100%)" },
      ],
      {
        duration: ROOM_PANEL_SLIDE_MS,
        easing: readRoomPanelSlideEasing(),
        fill: "forwards",
      },
    );
    exit.onfinish = () => removePanel();
    return () => exit.cancel();
  }, [isPresent, panelRef]);

  return isPresent;
}
