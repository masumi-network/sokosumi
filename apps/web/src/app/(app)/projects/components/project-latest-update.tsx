"use client";

import { useState } from "react";
import { SECTION_MARKDOWN_HEADINGS } from "@/app/projects/components/section-markdown-headings";
import { BRIEFING_COLLAPSE_CHAR_THRESHOLD } from "@/app/projects/project-briefing";
import { COLLAPSED_FADE_CLASS } from "@/components/collapsed-fade-class";
import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

interface ProjectLatestUpdateProps {
  title: string;
  content: string;
  showMoreLabel: string;
  showLessLabel: string;
}

export function ProjectLatestUpdate({
  title,
  content,
  showMoreLabel,
  showLessLabel,
}: ProjectLatestUpdateProps) {
  return (
    <section className="space-y-2" data-testid="project-latest-update">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      <CollapsibleSectionMarkdown
        id="project-latest-update-content"
        content={content}
        showMoreLabel={showMoreLabel}
        showLessLabel={showLessLabel}
      />
    </section>
  );
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
}: {
  /** The content's id, for the toggle's `aria-controls` and for tests. */
  id: string;
  content: string;
  showMoreLabel: string;
  showLessLabel: string;
}) {
  const isLong = content.length > BRIEFING_COLLAPSE_CHAR_THRESHOLD;
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
