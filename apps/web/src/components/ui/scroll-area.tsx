"use client";

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> {
  /**
   * Beat Radix's inline `display:table; min-width:100%` on the viewport
   * content wrapper so flex children can shrink below intrinsic min-content
   * (e.g. Chromium `<video controls>` in chat). Opt-in only — enabling this
   * on horizontal ScrollAreas breaks wide-content overflow sizing.
   */
  shrinkContent?: boolean;
}

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Viewport>,
  ScrollAreaProps
>(function ScrollArea(
  { className, children, shrinkContent = false, ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      data-scroll-area-shrink-content={shrinkContent ? "" : undefined}
      // `overflow-hidden` belongs to shadcn's own Root and was missing here.
      // The viewport already clips what you see, but without it the Root
      // reports its full unclipped content height to ancestors — so a
      // ScrollArea inside a scrollable container (a max-height dialog, say)
      // handed that container hundreds of pixels of empty scroll space.
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={ref}
        data-slot="scroll-area-viewport"
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          // `!` beats Radix inline styles on the content wrapper child.
          shrinkContent && "*:w-full *:!block *:!min-w-0",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
