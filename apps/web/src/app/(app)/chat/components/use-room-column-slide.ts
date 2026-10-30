import { useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

/** The enter pairing dialogs use (`duration-200 ease-out-strong`). */
const SLIDE_MS = 200;
const SLIDE_EASING_TOKEN = "--ease-out-strong";

/**
 * Slides the room's content column (header row, transcript, composer) when a
 * side panel docks or closes, instead of letting it jump.
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
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const main = mainRef.current;
    const section = sectionRef.current;
    if (!main || !section) return;
    // Read on every resize: `wrapColumn` (the file drop zone) can remount the
    // column body, so the nodes from mount may be gone.
    const columns = () => [
      headerRef.current,
      listRef.current,
      composerRef.current,
    ];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const easing =
      getComputedStyle(document.documentElement)
        .getPropertyValue(SLIDE_EASING_TOKEN)
        .trim() || "ease-out";
    const slides = new WeakMap<HTMLElement, Animation>();
    let mainWidth = main.clientWidth;
    // The header row, transcript and composer share
    // `ROOM_CONTENT_COLUMN_CLASSNAME`, so one left stands for all of them. A
    // per-node left would miss the header row when it mounts after this effect
    // (the mobile header moves back in on a resize to desktop), and the header
    // would jump while the rest slides.
    // offsetLeft is the layout position: it ignores the slide's own transform.
    const columnLeft = () => columns().find((column) => column)?.offsetLeft;
    let layoutLeft = columnLeft();

    // Runs after layout and before paint, so the first painted frame is
    // already the column at its old place.
    const observer = new ResizeObserver(() => {
      const nextWidth = main.clientWidth;
      const from = layoutLeft;
      const to = columnLeft();
      // A height-only resize leaves the column where it is: let a running
      // slide finish rather than restart it.
      if (
        nextWidth === mainWidth &&
        !reducedMotion.matches &&
        from !== undefined &&
        to !== undefined &&
        from !== to
      ) {
        for (const column of columns()) {
          if (!column) continue;
          // Start from where it is painted, so a toggle mid-slide does not jump.
          const paintedLeft =
            from + new DOMMatrix(getComputedStyle(column).transform).m41;
          slides.get(column)?.cancel();
          slides.set(
            column,
            column.animate(
              [
                { transform: `translateX(${paintedLeft - to}px)` },
                { transform: "none" },
              ],
              { duration: SLIDE_MS, easing },
            ),
          );
        }
      }
      mainWidth = nextWidth;
      layoutLeft = to;
    });
    observer.observe(main);
    observer.observe(section);
    return () => observer.disconnect();
  });

  return { mainRef, sectionRef, headerRef, listRef, composerRef };
}
