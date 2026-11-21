"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { matchesMediaQuery } from "@/hooks/effects/use-media-query";
import { useResizeObserver } from "@/hooks/effects/use-resize-observer";
import { cn } from "@/lib/utils";

interface EdgeColumn {
  id: string;
  title: string;
  count: number;
  statusColor: string;
}

/** The board's `px-2`: a column scrolled to the start keeps that inset. */
const BOARD_INSET_PX = 8;

function columnsPastEdge(scroller: HTMLElement) {
  if (!scroller.clientWidth) return [];
  const edge = scroller.getBoundingClientRect().right;
  return Array.from(scroller.querySelectorAll<HTMLElement>("[data-column-id]"))
    .filter((column) => column.getBoundingClientRect().left >= edge - 1)
    .map((column) => column.dataset.columnId ?? "");
}

/**
 * Names the board columns that sit wholly past its right edge, with their
 * counts, so a Task moved to Done stays in reach. Rendered as the board's last
 * child: it sticks to the visible right edge and takes no width.
 */
export function BoardEdgeShortcuts({ columns }: { columns: EdgeColumn[] }) {
  const t = useTranslations("App.Tasks.BoardEdge");
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const scroller = anchor?.parentElement ?? null;

  function measure() {
    if (!scroller) return;
    const next = columnsPastEdge(scroller);
    setHiddenIds((current) =>
      current.join() === next.join() ? current : next,
    );
  }
  useResizeObserver(scroller, measure, {
    immediate: true,
    observeChildren: true,
  });
  useEventListener(scroller, "scroll", measure, { passive: true });

  function show(id: string) {
    const column = scroller?.querySelector<HTMLElement>(
      `[data-column-id="${CSS.escape(id)}"]`,
    );
    if (!scroller || !column) return;
    scroller.scrollTo({
      left:
        scroller.scrollLeft +
        column.getBoundingClientRect().left -
        scroller.getBoundingClientRect().left -
        BOARD_INSET_PX,
      behavior: matchesMediaQuery("(prefers-reduced-motion: reduce)")
        ? "auto"
        : "smooth",
    });
    // The shortcut goes away once its column is in view; focus follows it.
    column.focus({ preventScroll: true });
  }

  const hiddenSet = new Set(hiddenIds);
  const hidden = columns.filter((column) => hiddenSet.has(column.id));
  return (
    <div
      ref={setAnchor}
      className="sticky right-0 -ml-3 w-0 shrink-0"
      data-no-drag-scroll
    >
      {hidden.length > 0 && (
        <nav
          aria-label={t("label")}
          className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col items-end gap-1.5"
        >
          {hidden.map((column) => (
            <Button
              key={column.id}
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 rounded-full shadow-sm"
              onClick={() => show(column.id)}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  column.statusColor,
                )}
                aria-hidden
              />
              {column.title}
              <span className="sr-only">
                {t("count", { count: column.count })}
              </span>
              <span className="text-muted-foreground tabular-nums" aria-hidden>
                {column.count}
              </span>
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          ))}
        </nav>
      )}
    </div>
  );
}
