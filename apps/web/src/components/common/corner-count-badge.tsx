import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A count on the top-right corner of a 32px header icon button: the
 * notification bell and the room header's Threads icon. The caller supplies
 * the fill and its foreground, and the button's `relative` box to anchor on.
 *
 * Its geometry matches the sidebar's `MentionCountPill`, a 16px pill with
 * 10px semibold tabular digits, so a count reads the same wherever it sits. It
 * is ringed in the header's own ground so it keeps its edge where it overlaps
 * the glyph. `aria-hidden`: the button's label states the count.
 */
export function CornerCountBadge({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "ring-background absolute -top-0.5 -right-0.5 inline-flex min-w-4.5 items-center justify-center rounded-full px-0.5 text-[0.625rem] leading-4 font-semibold tabular-nums ring-2",
        className,
      )}
      {...props}
    />
  );
}
