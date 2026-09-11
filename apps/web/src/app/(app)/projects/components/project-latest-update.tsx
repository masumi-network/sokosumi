"use client";

import { useState } from "react";

import { BRIEFING_COLLAPSE_CHAR_THRESHOLD } from "@/app/projects/project-briefing";
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
  const isLong = content.length > BRIEFING_COLLAPSE_CHAR_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="space-y-2" data-testid="project-latest-update">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>
      <div className="space-y-2">
        <div
          id="project-latest-update-content"
          data-testid="project-latest-update-content"
          className={cn(
            "text-foreground",
            isLong && !expanded && "max-h-64 overflow-hidden",
          )}
        >
          <Markdown>{content}</Markdown>
        </div>
        {isLong ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="project-latest-update-content"
            className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? showLessLabel : showMoreLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
