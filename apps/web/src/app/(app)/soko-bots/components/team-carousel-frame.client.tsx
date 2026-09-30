"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

/**
 * A scroll-snapping row: touch and trackpad scroll it natively, arrow keys
 * scroll it when focused, and the buttons page it on wider screens.
 */
export function TeamCarouselFrame({
  children,
  label,
  previousLabel,
  nextLabel,
}: {
  children: ReactNode;
  label: string;
  previousLabel: string;
  nextLabel: string;
}) {
  const rowRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setEdges({
      start: row.scrollLeft <= 1,
      end: row.scrollLeft + row.clientWidth >= row.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  const page = (direction: 1 | -1) =>
    rowRef.current?.scrollBy({
      left: direction * rowRef.current.clientWidth * 0.8,
      behavior: "smooth",
    });

  const scrollable = !(edges.start && edges.end);

  return (
    <div className="space-y-3">
      {scrollable ? (
        <div className="hidden justify-end gap-1 sm:flex">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={previousLabel}
            disabled={edges.start}
            onClick={() => page(-1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={nextLabel}
            disabled={edges.end}
            onClick={() => page(1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}
      <ul
        ref={rowRef}
        aria-label={label}
        // Focusable so arrow keys scroll it; the cards inside stay tabbable.
        tabIndex={0}
        className="focus-visible:ring-ring -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 outline-none [scrollbar-width:none] focus-visible:ring-2 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
    </div>
  );
}
