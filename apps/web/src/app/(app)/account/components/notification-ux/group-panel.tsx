"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The frame every layout in this round shares: a group that reads as one line
 * until it is opened.
 *
 * The row stacks below `sm`, so a wide control (three segments, a select, a
 * slider) drops under the title instead of squeezing it. That is the whole
 * answer to the overflow the earlier round had: nothing shrinks, it moves.
 *
 * The trigger covers the title and the summary only. The control sits outside
 * it, because a button inside a button is not a thing a browser can do, and
 * because tapping the summary should open the group rather than change it.
 */
export function GroupPanel({
  open,
  onOpenChange,
  title,
  summary,
  control,
  children,
  hideChevron = false,
  /** Puts the control under the title at every width, not only on phones. */
  stack = false,
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  summary: React.ReactNode;
  control?: React.ReactNode;
  children: React.ReactNode;
  hideChevron?: boolean;
  stack?: boolean;
  className?: string;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <div
        className={cn(
          "flex flex-col gap-3 px-4 py-3",
          !stack && "sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <CollapsibleTrigger className="group focus-visible:ring-ring/50 -m-1 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px]">
          {hideChevron ? null : (
            <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm leading-5 font-medium">
              {title}
            </span>
            <span className="text-muted-foreground block truncate text-sm leading-6">
              {summary}
            </span>
          </span>
        </CollapsibleTrigger>
        {control ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-2",
              !stack && "sm:justify-end",
            )}
          >
            {control}
          </div>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="bg-muted/20 border-t">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Which groups are open, by id.
 *
 * A hook rather than a prop, because several layouts need to open a group from
 * something other than its own chevron: a "Custom" segment, a menu item, a
 * group that turns custom while it is closed.
 */
export function useOpenGroups() {
  const [open, setOpen] = useState<readonly string[]>([]);

  return {
    isOpen: (id: string) => open.includes(id),
    setOpen: (id: string, next: boolean) =>
      setOpen((current) => {
        const without = current.filter((candidate) => candidate !== id);

        return next ? [...without, id] : without;
      }),
    /** One at a time, for the accordion layouts. */
    setOnly: (id: string, next: boolean) => setOpen(next ? [id] : []),
  };
}
