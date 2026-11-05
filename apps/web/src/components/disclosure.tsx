"use client";

import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";

import {
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The trigger of a disclosure: a chevron and what it opens. Used inside a
 * `Collapsible`, with `DisclosureContent` for the part that folds.
 */
export function DisclosureTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring -m-1 flex items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    >
      {/* Turned on the same 200ms ease-out the fold opens on, so the mark and
          the box it belongs to stop together. Under reduced motion it has no
          transition at all and simply points the other way, which is what the
          fold does too. */}
      <ChevronRight className="text-muted-foreground size-4 shrink-0 duration-200 ease-out group-data-[state=open]:rotate-90 motion-safe:transition-transform" />
      {children}
    </CollapsibleTrigger>
  );
}

/**
 * The part of a disclosure that folds. It measures itself and slides open, and
 * `overflow-hidden` is what makes that height mean anything. A reader who
 * asked for less motion gets a jump.
 */
export function DisclosureContent({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className={cn(
        "motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}
