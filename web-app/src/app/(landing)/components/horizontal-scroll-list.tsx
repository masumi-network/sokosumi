import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface HorizontalScrollListProps {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
}

export function HorizontalScrollList({
  children,
  className,
  containerClassName,
}: HorizontalScrollListProps) {
  return (
    <div className={cn("relative w-full", containerClassName)}>
      {/* Hide scrollbar in Firefox */}
      <div className="scrollbar-none overflow-x-auto">
        {/* Hide scrollbar in Webkit/Chromium browsers */}
        <div
          className={cn(
            "flex w-max gap-6 pb-4",
            "scrollbar-none [&::-webkit-scrollbar]:hidden",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
