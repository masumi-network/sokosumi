"use client";

import type { ReactNode } from "react";

import { DisclosureContent, DisclosureTrigger } from "@/components/disclosure";
import { Collapsible } from "@/components/ui/collapsible";

/** Archived bots, folded under one quiet row at the end of the section. */
export function ArchivedFold({
  label,
  count,
  children,
}: {
  label: string;
  count: string;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <DisclosureTrigger className="text-muted-foreground hover:text-foreground mx-1 mt-1 text-xs font-medium">
        {label}
        <span className="tabular-nums">{count}</span>
      </DisclosureTrigger>
      <DisclosureContent>
        {/* Room around the cards for the focus ring that the fold clips. */}
        <div className="-mx-1 px-1 pt-2 pb-1">{children}</div>
      </DisclosureContent>
    </Collapsible>
  );
}
