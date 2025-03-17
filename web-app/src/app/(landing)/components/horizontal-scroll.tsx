import React from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface HorizontalScrollProps {
  children: React.ReactNode;
  containerClassName?: string;
}

export default function HorizontalScroll({
  children,
  containerClassName,
}: HorizontalScrollProps) {
  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div
        className={cn(
          "flex h-full w-full justify-center gap-6 px-6 [&:not(:has(>*:nth-child(2)))]:justify-center",
          containerClassName,
        )}
      >
        <div className="flex gap-6">{children}</div>
      </div>
      <ScrollBar orientation="horizontal" className="hidden" />
    </ScrollArea>
  );
}
