"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Collapsible section heading for the chat sidebar (Channels, External,
 * Archived, Direct Messages).
 *
 * The trailing padding steps with how many action controls sit in the
 * absolutely-positioned trailing slot, so a long section title truncates
 * before it runs under them.
 */
export function ChatSidebarSectionHeader({
  children,
  isOpen,
  createAction,
  secondaryAction,
}: {
  children: ReactNode;
  isOpen: boolean;
  createAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const trailingCount = (secondaryAction ? 1 : 0) + (createAction ? 1 : 0);

  return (
    <div className="group-data-[collapsible=icon]:hidden relative flex h-10 items-center gap-1 px-3 md:h-8">
      <CollapsibleTrigger
        className={cn(
          "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-medium transition-colors md:text-xs",
          trailingCount === 1 && "pr-9",
          trailingCount >= 2 && "pr-16",
          trailingCount === 0 && "md:pr-0",
          trailingCount === 1 && "md:pr-8",
          trailingCount >= 2 && "md:pr-14",
        )}
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform md:size-3",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="truncate">{children}</span>
      </CollapsibleTrigger>
      {trailingCount > 0 ? (
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          {secondaryAction}
          {createAction}
        </div>
      ) : null}
    </div>
  );
}
