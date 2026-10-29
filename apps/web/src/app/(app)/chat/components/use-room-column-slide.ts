import { useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

const SLIDE_MS = 260;
const SLIDE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Slides the room's content column when a side panel docks or closes, instead
 * of letting it jump. `ROOM_CONTENT_COLUMN_CLASSNAME` already moves the column
 * as little as it can; this animates what is left with a transform (FLIP), so
 * layout never animates. A panel toggle is the one resize where the section
 * changes width and the room pane does not: window and sidebar resizes change
 * the pane too and stay instant. Below `lg` panels overlay the section, so
 * nothing moves. Off under reduced motion.
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
    const columns = [listRef, composerRef].flatMap((ref) =>
      ref.current ? [ref.current] : [],
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const slides = new WeakMap<HTMLElement, Animation>();
    let mainWidth = main.clientWidth;
    // Layout positions (offsetLeft ignores the slide's own transform).
    let lefts = columns.map((column) => column.offsetLeft);

    // Runs after layout and before paint, so the first painted frame is
    // already the column at its old place.
    const observer = new ResizeObserver(() => {
      const nextWidth = main.clientWidth;
      const nextLefts = columns.map((column) => column.offsetLeft);
      if (nextWidth === mainWidth && !reducedMotion.matches) {
        columns.forEach((column, index) => {
          // Start from where it is painted, so a toggle mid-slide does not jump.
          const shown =
            lefts[index] +
            new DOMMatrix(getComputedStyle(column).transform).m41;
          slides.get(column)?.cancel();
          const dx = shown - nextLefts[index];
          if (dx === 0) return;
          slides.set(
            column,
            column.animate(
              [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
              { duration: SLIDE_MS, easing: SLIDE_EASING },
            ),
          );
        });
      }
      mainWidth = nextWidth;
      lefts = nextLefts;
    });
    observer.observe(main);
    observer.observe(section);
    return () => observer.disconnect();
  });

  return { mainRef, sectionRef, listRef, composerRef };
}
