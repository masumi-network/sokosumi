"use client";

import { useDragToScroll } from "@/hooks/effects/use-drag-to-scroll";
import { useScrollIntoViewWhen } from "@/hooks/effects/use-scroll-into-view-when";
import { cn } from "@/lib/utils";

interface DragScrollContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function DragScrollContainer({
  children,
  className,
}: DragScrollContainerProps) {
  const scrollRef = useDragToScroll<HTMLDivElement>();

  // `/tasks#input-required` (Home's "need your input" link) opens the board
  // on that column instead of on Backlog, where it sat out of view.
  useScrollIntoViewWhen(
    () => {
      const columnId = window.location.hash.slice(1);
      return columnId
        ? scrollRef.current?.querySelector(
            `[data-column-id="${CSS.escape(columnId)}"]`,
          )
        : null;
    },
    true,
    { block: "nearest", inline: "start" },
  );

  return (
    <div
      ref={scrollRef}
      className={cn(
        "cursor-grab data-[drag-scrolling=true]:cursor-grabbing data-[drag-scrolling=true]:select-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
