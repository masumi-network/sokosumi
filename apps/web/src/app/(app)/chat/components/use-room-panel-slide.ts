import { usePresence } from "motion/react";
import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

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

/** How far a running slide has moved `node` from its layout position. */
function readPaintedOffset(node: HTMLElement): number {
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
) {
  const [isPresent, safeToRemove] = usePresence();
  // `safeToRemove` is new on every render. As an effect dependency, each render
  // during the slide would restart it, and a streaming room would never let the
  // panel unmount.
  const removePanel = useEffectEvent(() => safeToRemove?.());

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
      removePanel();
      return;
    }
    // Start from where it is painted, so closing mid-slide does not jump.
    const exit = panel.animate(
      [
        { transform: `translateX(${readPaintedOffset(panel)}px)` },
        { transform: "translateX(100%)" },
      ],
      { duration: SLIDE_MS, easing: readSlideEasing(), fill: "forwards" },
    );
    exit.onfinish = () => removePanel();
    return () => exit.cancel();
  }, [isPresent, panelRef]);

  return isPresent;
}

/**
 * Slides the room's content column (transcript, composer), the header's actions
 * and an opening side panel when a panel docks or closes, instead of letting
 * them jump.
 * `ROOM_CONTENT_COLUMN_CLASSNAME` already moves the column as little as it can;
 * this animates what is left with a transform (FLIP), so layout never animates.
 * A panel toggle is the one resize where the section changes width and the room
 * pane does not: window and sidebar resizes change the pane too and stay
 * instant. Swapping one docked panel for another of a different width also
 * changes the section, but the panel's edge moves at once with its content, so
 * nothing slides. Below `lg` panels overlay the section, so nothing moves. Off
 * under reduced motion.
 */
export function useRoomPanelSlide() {
  const mainRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
      const startOffset = distance + readPaintedOffset(node);
      slides.get(node)?.cancel();
      slides.set(
        node,
        node.animate(
          [
            { transform: `translateX(${startOffset}px)` },
            { transform: "none" },
          ],
          { duration: SLIDE_MS, easing },
        ),
      );
    };
    let mainWidth = main.clientWidth;
    let sectionWidth = section.clientWidth;
    // A closing panel's slot is `inert` until it unmounts.
    const isPanelDocked = () => {
      const panel = panelRef.current;
      return panel !== null && !panel.inert;
    };
    let panelDocked = isPanelDocked();
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
      const nextPanelDocked = isPanelDocked();
      const from = layoutLeft;
      const to = columnLeft();
      if (
        nextWidth === mainWidth &&
        !reducedMotion.matches &&
        !(panelDocked && nextPanelDocked)
      ) {
        // A height-only resize leaves the column where it is: let a running
        // slide finish rather than restart it.
        if (from !== undefined && to !== undefined && from !== to) {
          for (const column of columns()) {
            if (column) slide(column, from - to);
          }
        }
        // The actions move by whatever the section gained or lost. Measured
        // from the section, because the header can mount after this effect.
        const sectionShrink = sectionWidth - nextSectionWidth;
        const actions = section.querySelector<HTMLElement>(
          `[data-slot="${ROOM_HEADER_ACTIONS_SLOT}"]`,
        );
        if (actions && sectionShrink !== 0) slide(actions, sectionShrink);
        // A docking panel comes in by the same distance, so the actions keep
        // their gap to it all the way. A closing one, the only reason the
        // section widens here, is `useRoomPanelSlideOut`'s.
        if (panelRef.current && sectionShrink > 0) {
          slide(panelRef.current, sectionShrink);
        }
      }
      mainWidth = nextWidth;
      sectionWidth = nextSectionWidth;
      panelDocked = nextPanelDocked;
      layoutLeft = to;
    });
    observer.observe(main);
    observer.observe(section);
    return () => observer.disconnect();
  });

  return { mainRef, sectionRef, panelRef, listRef, composerRef };
}
