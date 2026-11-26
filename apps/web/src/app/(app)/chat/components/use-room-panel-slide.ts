import { useMemo, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/effects/use-media-query";
import { useResizeObserver } from "@/hooks/effects/use-resize-observer";
import {
  ROOM_PANEL_SLIDE_MS,
  readRoomPanelPaintedOffset,
  readRoomPanelSlideEasing,
} from "@/hooks/effects/use-room-panel-slide-out";

/** Marks the header's actions, which end at the section's right edge. */
export const ROOM_HEADER_ACTIONS_SLOT = "room-header-actions";

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
  const [main, setMain] = useState<HTMLDivElement | null>(null);
  const [section, setSection] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const targets = useMemo(
    () => (main && section ? ([main, section] as const) : null),
    [main, section],
  );
  const slideStateRef = useRef<{
    easing: string;
    slides: WeakMap<HTMLElement, Animation>;
    mainWidth: number;
    sectionWidth: number;
    panelDocked: boolean;
    layoutLeft: number | undefined;
  } | null>(null);

  useResizeObserver(
    targets,
    (entries) => {
      if (!main || !section) return;
      // Read on every resize: `wrapColumn` (the file drop zone) can remount the
      // column body, so the nodes from mount may be gone.
      const columns = () => [listRef.current, composerRef.current];
      // A closing panel's slot is `inert` until it unmounts.
      const isPanelDocked = () => {
        const panel = panelRef.current;
        return panel !== null && !panel.inert;
      };
      // The transcript and composer share `ROOM_CONTENT_COLUMN_CLASSNAME`, so one
      // left stands for both.
      // offsetLeft is the layout position: it ignores the slide's own transform.
      const columnLeft = () => columns().find((column) => column)?.offsetLeft;

      if (entries.length === 0 || !slideStateRef.current) {
        slideStateRef.current = {
          easing: readRoomPanelSlideEasing(),
          slides: new WeakMap<HTMLElement, Animation>(),
          mainWidth: main.clientWidth,
          sectionWidth: section.clientWidth,
          panelDocked: isPanelDocked(),
          layoutLeft: columnLeft(),
        };
        return;
      }

      const state = slideStateRef.current;
      const slide = (node: HTMLElement, distance: number) => {
        // Start from where it is painted, so a toggle mid-slide does not jump.
        const startOffset = distance + readRoomPanelPaintedOffset(node);
        state.slides.get(node)?.cancel();
        state.slides.set(
          node,
          node.animate(
            [
              { transform: `translateX(${startOffset}px)` },
              { transform: "none" },
            ],
            { duration: ROOM_PANEL_SLIDE_MS, easing: state.easing },
          ),
        );
      };

      // Runs after layout and before paint, so the first painted frame is
      // already the column at its old place.
      const nextWidth = main.clientWidth;
      const nextSectionWidth = section.clientWidth;
      const nextPanelDocked = isPanelDocked();
      const from = state.layoutLeft;
      const to = columnLeft();
      if (
        nextWidth === state.mainWidth &&
        !reduceMotion &&
        !(state.panelDocked && nextPanelDocked)
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
        const sectionShrink = state.sectionWidth - nextSectionWidth;
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
      state.mainWidth = nextWidth;
      state.sectionWidth = nextSectionWidth;
      state.panelDocked = nextPanelDocked;
      state.layoutLeft = to;
    },
    { immediate: true },
  );

  return {
    mainRef: setMain,
    sectionRef: setSection,
    panelRef,
    listRef,
    composerRef,
  };
}
