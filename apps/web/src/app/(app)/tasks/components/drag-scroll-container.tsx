"use client";

import { useDragToScroll } from "@/hooks/effects/use-drag-to-scroll";
import { useMountEffect } from "@/hooks/use-mount-effect";
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
  useMountEffect(() => {
    const columnId = window.location.hash.slice(1);
    if (!columnId) return;
    scrollRef.current
      ?.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "start" });
  });

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
