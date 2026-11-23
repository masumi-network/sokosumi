"use client";

import { type ReactNode, useState } from "react";

import { DisclosureContent, DisclosureTrigger } from "@/components/disclosure";
import {
  usePageListSearch,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { Collapsible } from "@/components/ui/collapsible";

interface ArchivedSharedBotsProps {
  label: string;
  rows: {
    primary: (string | null | undefined)[];
    secondary?: (string | null | undefined)[];
    content: ReactNode;
  }[];
}

/**
 * Archived shared bots, folded under one row so the live ones lead. A filter
 * that matches an archived bot opens the row; one that matches none hides it.
 */
export function ArchivedSharedBots({ label, rows }: ArchivedSharedBotsProps) {
  const query = usePageSearchQuery();
  const visible = usePageListSearch(rows, (row) => row);
  const matched = query !== "" && visible.length > 0;
  const [open, setOpen] = useState(matched);
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    if (matched) setOpen(true);
  }

  if (query && visible.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <DisclosureTrigger className="text-muted-foreground hover:text-foreground mx-2 my-1 text-sm font-medium">
        {label}
        <span className="tabular-nums">{visible.length}</span>
      </DisclosureTrigger>
      <DisclosureContent>
        {/* Room around the cards for the focus ring that the fold clips. */}
        <ul className="-mx-1 grid gap-2 px-1 pt-2 pb-1 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
          {visible.map((row) => row.content)}
        </ul>
      </DisclosureContent>
    </Collapsible>
  );
}
