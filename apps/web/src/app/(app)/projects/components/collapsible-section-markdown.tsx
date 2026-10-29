"use client";

import { useState } from "react";
import { SECTION_MARKDOWN_HEADINGS } from "@/app/projects/components/section-markdown-headings";
import { COLLAPSED_FADE_CLASS } from "@/components/collapsed-fade-class";
import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

/** Markdown longer than this starts collapsed behind Show more. */
export const SECTION_COLLAPSE_CHAR_THRESHOLD = 480;

interface CollapsibleSectionMarkdownProps {
  /** The content's id, for the toggle's `aria-controls` and for tests. */
  id: string;
  content: string;
  showMoreLabel: string;
  showLessLabel: string;
}

/**
 * A section's markdown, capped and faded at the bottom when it is long, with
 * one Show more toggle. Latest update and Briefing share it, so the two
 * toggles cannot drift apart again.
 */
export function CollapsibleSectionMarkdown({
  id,
  content,
  showMoreLabel,
  showLessLabel,
}: CollapsibleSectionMarkdownProps) {
  const isLong = content.length > SECTION_COLLAPSE_CHAR_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const isCollapsed = isLong && !expanded;

  return (
    <div className="space-y-2">
      <div
        id={id}
        data-testid={id}
        className={cn(
          "text-foreground",
          isCollapsed && "max-h-64 overflow-hidden",
          isCollapsed && COLLAPSED_FADE_CLASS,
        )}
      >
        <Markdown components={SECTION_MARKDOWN_HEADINGS}>{content}</Markdown>
      </div>
      {isLong ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          className="text-muted-foreground hover:text-foreground press rounded-sm text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? showLessLabel : showMoreLabel}
        </button>
      ) : null}
    </div>
  );
}
