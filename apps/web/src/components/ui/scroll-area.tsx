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
          "focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring size-full rounded-[inherit] transition-[color] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
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
      // Same geometry and colors as the `app-scrollbar` utility, so a Radix
      // overlay scrollbar and a native one read as the same control: a 12px
      // track with a 3px inset and a thumb that walks the same ramp on hover
      // and press.
      className={cn(
        "flex touch-none p-[3px] transition-colors select-none",
        orientation === "vertical" && "h-full w-3",
        orientation === "horizontal" && "h-3 flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-scrollbar-thumb hover:bg-muted-foreground active:bg-foreground relative flex-1 rounded-full transition-colors"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
