import React from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface HorizontalScrollProps {
  children: React.ReactNode;
  itemClassName?: string;
  containerClassName?: string;
}

export default function HorizontalScroll({
  children,
  itemClassName,
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
        <div className="flex gap-6">
          {React.Children.map(children, (child) => (
            <div className={cn("flex-shrink-0", itemClassName)}>{child}</div>
          ))}
        </div>
      </div>
      <ScrollBar orientation="horizontal" className="hidden" />
    </ScrollArea>
  );
}
