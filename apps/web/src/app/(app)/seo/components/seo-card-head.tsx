"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { HOLDER_ITEM_HOVER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** The title row of an action card: a button that opens and closes the card, or plain text where the card stays open. */
export function SeoActionCardHead({
  bodyId,
  open,
  onToggle,
  children,
}: {
  bodyId: string;
  open: boolean;
  /** Absent where the card stays open. */
  onToggle: (() => void) | undefined;
  children: ReactNode;
}) {
  // An open card has its page link directly under the title: the head ends close over it.
  const pad = open ? "pt-3 pb-1" : "py-3";
  if (!onToggle)
    return (
      <span className={cn("flex items-center gap-3 px-4", pad)}>
        {children}
      </span>
    );
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? bodyId : undefined}
      onClick={onToggle}
      className={cn(
        HOLDER_ITEM_HOVER_CLASS,
        "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 text-start outline-none focus-visible:ring-2",
        pad,
      )}
    >
      {children}
      <ChevronDown
        className={cn(
          "text-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
          open && "rotate-180",
        )}
      />
    </button>
  );
}
