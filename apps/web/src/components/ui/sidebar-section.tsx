"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The button of a foldable sidebar heading — a nav group's (Work, Records,
 * Marketing) or a chat section's (Pinned, Channels, …) — so every heading in
 * the sidebar reads alike: the title, then a chevron.
 *
 * The chevron stays out of the way while the section is open and shows on
 * hover or keyboard focus, so the heading reads as a label until it is
 * reached for. A closed section keeps it, turned to point right, so a folded
 * group is never mistaken for an empty one. Radix sets `data-state` on the
 * trigger, so the chevron follows it without the caller passing open state.
 * The turn is movement and stops under reduced motion; the fade is not.
 */
export function SidebarSectionTrigger({
  title,
  screenReaderNote,
  className,
}: {
  title: string;
  /** Read after the title by screen readers only. */
  screenReaderNote?: string | null;
  className?: string;
}) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group/section text-muted-foreground hover:text-foreground ring-sidebar-ring flex h-full min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-medium outline-hidden transition-colors focus-visible:ring-2 md:text-xs",
        className,
      )}
    >
      <span className="min-w-0 truncate">{title}</span>
      <ChevronDown
        aria-hidden
        className="size-4 shrink-0 opacity-0 transition-[opacity,rotate] duration-150 ease-out group-hover/section:opacity-100 group-focus-visible/section:opacity-100 group-data-[state=closed]/section:-rotate-90 group-data-[state=closed]/section:opacity-100 motion-reduce:transition-opacity md:size-3"
      />
      {screenReaderNote ? (
        <span className="sr-only">{screenReaderNote}</span>
      ) : null}
    </CollapsibleTrigger>
  );
}

/**
 * The rows under a sidebar heading, sliding on the same motion as the
 * Projects disclosure in the main sidebar: height travels with the rows, so
 * every section below moves with them instead of jumping.
 *
 * The height animation needs `overflow-hidden`, which would otherwise clip a
 * row's focus `ring-2` where the rows meet the box's edges. A negative margin
 * pushes the clip edge out — by the group's gutter sideways, by the ring's
 * 2px vertically — and the padding puts the rows back where they were. The
 * ring is a fixed 2px, not a spacing step, so the vertical pair is in `px`:
 * on the scale it would be `0.125rem` and come out under 2px below a 16px
 * root, where the ring would lose part of its stroke again.
 *
 * Outer height is unchanged (−2px margin, +2px padding), so the collapse
 * animation and the gap to the next section stay as they were. What the
 * negative margin does change is hit testing: the 2px strip lies over the
 * bottom of the section heading above, which paints earlier and would lose
 * those hits. So the box itself takes no pointer events and hands them back
 * on its rows, which start inside the padding and leave the strip to the
 * heading.
 */
export function SidebarSectionContent({
  children,
  className,
}: {
  children: ReactNode;
  /** For a section whose rows leave the box on their own — see Pinned. */
  className?: string;
}) {
  return (
    <CollapsibleContent
      className={cn(
        "motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down -mx-2 -my-[2px] overflow-hidden px-2 py-[2px] pointer-events-none [&>*]:pointer-events-auto",
        className,
      )}
    >
      {children}
    </CollapsibleContent>
  );
}
