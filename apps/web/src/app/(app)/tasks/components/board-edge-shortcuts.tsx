"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TASKS_BOARD_EDGE_ROW_CLASS } from "@/app/tasks/constants";
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
 * counts, so a Task moved to Done stays in reach. It is the reserved row above
 * the board's scroller (`data-board-scroller`), so it never covers a card.
 */
export function BoardEdgeShortcuts({ columns }: { columns: EdgeColumn[] }) {
  const t = useTranslations("App.Tasks.BoardEdge");
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const scroller =
    anchor?.parentElement?.querySelector<HTMLElement>(
      "[data-board-scroller]",
    ) ?? null;

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
    // Scrolls sideways only when the shortcuts outgrow a narrow screen.
    <div
      ref={setAnchor}
      className={cn(TASKS_BOARD_EDGE_ROW_CLASS, "min-w-0 overflow-x-auto")}
    >
      {hidden.length > 0 && (
        <nav
          aria-label={t("label")}
          className="ml-auto flex w-max items-center gap-1.5"
        >
          {hidden.map((column) => (
            <Button
              key={column.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
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
              <ChevronRight aria-hidden className="size-3.5" />
            </Button>
          ))}
        </nav>
      )}
    </div>
  );
}
