"use client";

import { type ReactNode, useCallback, useState } from "react";

import { useResizeObserver } from "@/hooks/effects/use-resize-observer";

/** Width of the fade on a clipped edge; focus scrolls a chip clear of it. */
const FADE = "1.5rem";

interface Edges {
  /** Chips are hidden before the start. */
  start: boolean;
  /** Chips are hidden past the end. */
  end: boolean;
}

/**
 * The active filter chips on one line beside the view switcher. Chips keep
 * their whole label and the line scrolls instead of wrapping, so the toolbar
 * is as tall with any number of filters as with none, and the loading shell
 * holds the board where it lands.
 *
 * The line is its own named scroll region: Tab reaches it, the arrow keys
 * pan it, and focus on a chip's remove button scrolls the chip clear of the
 * edge fades (`scroll-padding`). A clipped edge fades. The fade is the only
 * cue: it is not a control and covers nothing a pointer or keyboard needs.
 */
export function TasksFilterChipStrip({
  label,
  itemsKey,
  children,
}: {
  label: string;
  /** Changes when the chips change, so the edges are measured again. */
  itemsKey: string;
  children: ReactNode;
}) {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  const updateEdges = useCallback((element: HTMLUListElement) => {
    const max = element.scrollWidth - element.clientWidth;
    const next = {
      start: element.scrollLeft > 1,
      end: element.scrollLeft < max - 1,
    };
    setEdges((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, []);

  // Syncs with the browser's layout: scroll position and box size.
  // New chips change the line's width without resizing its box.
  useResizeObserver(
    itemsKey ? list : null,
    () => {
      if (list) updateEdges(list);
    },
    { immediate: true, resetKey: itemsKey },
  );

  return (
    // The padding keeps focus rings inside the scroll box.
    <ul
      ref={setList}
      onScroll={
        itemsKey ? (event) => updateEdges(event.currentTarget) : undefined
      }
      aria-label={label}
      // A scroll region the keyboard pans with the arrow keys.
      tabIndex={0}
      data-overflow-start={edges.start || undefined}
      data-overflow-end={edges.end || undefined}
      className="focus-visible:ring-ring focus-visible:ring-inset -m-1 flex min-w-0 flex-1 scroll-px-6 items-center gap-2 overflow-x-auto rounded-full p-1 outline-none [scrollbar-width:none] focus-visible:ring-2"
      style={
        edges.start || edges.end
          ? {
              maskImage: `linear-gradient(to right, ${
                edges.start ? `transparent, black ${FADE}` : "black"
              }, ${edges.end ? `black calc(100% - ${FADE}), transparent` : "black"})`,
            }
          : undefined
      }
    >
      {children}
    </ul>
  );
}
