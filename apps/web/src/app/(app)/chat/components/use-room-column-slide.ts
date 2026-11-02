import { usePresence } from "motion/react";
import { useEffect, useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

/** The enter pairing dialogs use (`duration-200 ease-out-strong`). */
const SLIDE_MS = 200;
const SLIDE_EASING_TOKEN = "--ease-out-strong";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Marks the header's actions, which end at the section's right edge. */
export const ROOM_HEADER_ACTIONS_SLOT = "room-header-actions";

function readSlideEasing(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(SLIDE_EASING_TOKEN)
      .trim() || "ease-out"
  );
}

/**
 * Slides a closing side panel out past the pane's edge, then lets
 * `AnimatePresence` unmount it. Its slot leaves the flow as soon as it closes
 * (`isPresent` false), so `useRoomColumnSlide` sees the section widen in the
 * same frame and everything moves together.
 */
export function useRoomPanelSlideOut() {
  const [isPresent, safeToRemove] = usePresence();
  const panelRef = useRef<HTMLDivElement>(null);

  // Not a layout effect: `AnimatePresence` registers the exit in its own layout
  // effect, after this child's, and ignores a removal that comes before it.
  useEffect(() => {
    if (isPresent) return;
    const panel = panelRef.current;
    // Below `lg` the slot is `display: contents` and has no box: the panel
    // overlays the room, so it just goes.
    if (
      !panel ||
      panel.offsetWidth === 0 ||
      window.matchMedia(REDUCED_MOTION_QUERY).matches
    ) {
      safeToRemove?.();
      return;
    }
    // Start from where it is painted, so closing mid-slide does not jump.
    const paintedOffset = new DOMMatrix(getComputedStyle(panel).transform).m41;
    const exit = panel.animate(
      [
        { transform: `translateX(${paintedOffset}px)` },
        { transform: "translateX(100%)" },
      ],
      { duration: SLIDE_MS, easing: readSlideEasing(), fill: "forwards" },
    );
    exit.onfinish = () => safeToRemove?.();
    return () => exit.cancel();
  }, [isPresent, safeToRemove]);

  return { panelRef, isPresent };
}

/**
 * Slides the room's content column (transcript, composer), the header's actions
 * and an opening side panel when a panel docks or closes, instead of letting
 * them jump.
 * `ROOM_CONTENT_COLUMN_CLASSNAME` already moves the column as little as it can;
 * this animates what is left with a transform (FLIP), so layout never animates.
 * A panel toggle is the one resize where the section changes width and the room
 * pane does not: window and sidebar resizes change the pane too and stay
 * instant. Below `lg` panels overlay the section, so nothing moves. Off under
 * reduced motion.
 */
export function useRoomColumnSlide() {
  const mainRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const main = mainRef.current;
    const section = sectionRef.current;
    if (!main || !section) return;
    // Read on every resize: `wrapColumn` (the file drop zone) can remount the
    // column body, so the nodes from mount may be gone.
    const columns = () => [listRef.current, composerRef.current];
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const easing = readSlideEasing();
    const slides = new WeakMap<HTMLElement, Animation>();
    const slide = (node: HTMLElement, distance: number) => {
      // Start from where it is painted, so a toggle mid-slide does not jump.
      const paintedOffset =
        distance + new DOMMatrix(getComputedStyle(node).transform).m41;
      slides.get(node)?.cancel();
      slides.set(
        node,
        node.animate(
          [
            { transform: `translateX(${paintedOffset}px)` },
            { transform: "none" },
          ],
          { duration: SLIDE_MS, easing },
        ),
      );
    };
    let mainWidth = main.clientWidth;
    let sectionWidth = section.clientWidth;
    // The transcript and composer share `ROOM_CONTENT_COLUMN_CLASSNAME`, so one
    // left stands for both.
    // offsetLeft is the layout position: it ignores the slide's own transform.
    const columnLeft = () => columns().find((column) => column)?.offsetLeft;
    let layoutLeft = columnLeft();

    // Runs after layout and before paint, so the first painted frame is
    // already the column at its old place.
    const observer = new ResizeObserver(() => {
      const nextWidth = main.clientWidth;
      const nextSectionWidth = section.clientWidth;
      const from = layoutLeft;
      const to = columnLeft();
      if (nextWidth === mainWidth && !reducedMotion.matches) {
        // A height-only resize leaves the column where it is: let a running
        // slide finish rather than restart it.
        if (from !== undefined && to !== undefined && from !== to) {
          for (const column of columns()) {
            if (column) slide(column, from - to);
          }
        }
        // The actions move by whatever the section gained or lost. Measured
        // from the section, because the header can mount after this effect.
        const lost = sectionWidth - nextSectionWidth;
        const actions = section.querySelector<HTMLElement>(
          `[data-slot="${ROOM_HEADER_ACTIONS_SLOT}"]`,
        );
        if (actions && lost !== 0) slide(actions, lost);
        // A docking panel comes in by the same distance, so the actions keep
        // their gap to it all the way. A closing one is
        // `useRoomPanelSlideOut`'s, and a section that widens has no panel to
        // bring in.
        const panel = section.nextElementSibling;
        if (panel instanceof HTMLElement && lost > 0) slide(panel, lost);
      }
      mainWidth = nextWidth;
      sectionWidth = nextSectionWidth;
      layoutLeft = to;
    });
    observer.observe(main);
    observer.observe(section);
    return () => observer.disconnect();
  });

  return { mainRef, sectionRef, listRef, composerRef };
}
