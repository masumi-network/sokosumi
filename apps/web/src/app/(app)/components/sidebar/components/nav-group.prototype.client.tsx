"use client";

/**
 * PROTOTYPE, throwaway: a nav group under a small heading, for sidebar
 * variants b and c. The heading folds its group; the chevron after the title
 * shows on hover and stays while the group is closed, as the chat sections'
 * headings do in those variants. The rail drops the heading and keeps every
 * row, so a closed group never hides an icon there. State is in memory only.
 */

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SidebarMenu, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function NavPrototypeSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const { state, isMobile } = useSidebar();
  const rail = state === "collapsed" && !isMobile;

  return (
    <Collapsible
      open={open || rail}
      onOpenChange={setOpen}
      className="mt-3 group-data-[collapsible=icon]:mt-2"
    >
      <CollapsibleTrigger className="group/section text-muted-foreground hover:text-foreground ring-sidebar-ring flex h-6 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium outline-hidden focus-visible:ring-2 group-data-[collapsible=icon]:hidden">
        <span className="truncate">{title}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-[opacity,rotate] duration-200 motion-reduce:transition-none",
            open
              ? "opacity-0 group-hover/section:opacity-100 group-focus-visible/section:opacity-100"
              : "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenu className="gap-0">{children}</SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}
