import { type LucideIcon, X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The remove control at the end of a chip: a square segment the full height
 * of the chip, 40px below `md` and 28px from `md` up, where `hit-area` pads
 * it to 32px (DESIGN.md → Accessibility → Touch targets).
 *
 * The box itself is the target below `md`, so no pseudo-element reaches into
 * the next row of a wrapping chip list. The chip around it drops its end and
 * block padding (`py-0 pe-0`) and grows to the segment, and lets the 2px
 * `hit-area` overhang through (`overflow-visible` on a `Badge`). The segment
 * takes the chip's radius, so it stays concentric on any chip shape.
 *
 * `icon` swaps the `X` for an end action of the same kind, such as undoing a
 * rejected tag.
 */
export function ChipRemoveButton({
  className,
  icon: Icon = X,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  "aria-label": string;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      className={cn(
        "press hit-area text-muted-foreground hover:bg-card-background-hover hover:text-foreground focus-visible:ring-ring inline-flex size-10 shrink-0 items-center justify-center rounded-[inherit] outline-none transition-[color,background-color,transform] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 md:size-7",
        className,
      )}
      {...props}
    >
      <Icon className="size-3" />
    </button>
  );
}
