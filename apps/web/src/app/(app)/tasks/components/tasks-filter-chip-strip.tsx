"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
 * holds the board where it lands. A clipped edge fades and shows an arrow
 * that scrolls the line; keyboard focus scrolls a chip into view by itself.
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
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      const next = {
        start: list.scrollLeft > 1,
        end: list.scrollLeft < max - 1,
      };
      setEdges((prev) =>
        prev.start === next.start && prev.end === next.end ? prev : next,
      );
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [itemsKey]);

  const scrollBy = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollBy({
      left: direction * list.clientWidth * 0.8,
      behavior: reduce ? "auto" : "smooth",
    });
  };

  return (
    <div className="relative flex min-w-0 flex-1">
      {/* The padding keeps focus rings inside the scroll box. */}
      <ul
        ref={listRef}
        aria-label={label}
        data-overflow-start={edges.start || undefined}
        data-overflow-end={edges.end || undefined}
        className="-m-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto p-1 [scrollbar-width:none]"
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
      {/* Pointer help only: the chips themselves stay in the tab order. */}
      {edges.start ? (
        <EdgeButton side="start" onClick={() => scrollBy(-1)} />
      ) : null}
      {edges.end ? <EdgeButton side="end" onClick={() => scrollBy(1)} /> : null}
    </div>
  );
}

function EdgeButton({
  side,
  onClick,
}: {
  side: "start" | "end";
  onClick: () => void;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      data-chip-strip-scroll={side}
      onClick={onClick}
      className={cn(
        "bg-muted text-foreground hover:bg-card-background-hover absolute top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors",
        side === "start" ? "start-0" : "end-0",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
