"use client";

import { useDragToScroll } from "@/hooks/use-drag-to-scroll";
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
