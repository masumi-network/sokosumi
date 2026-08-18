"use client";

import Link from "next/link";
import { useState } from "react";

import { BRIEFING_COLLAPSE_CHAR_THRESHOLD } from "@/app/projects/project-briefing";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectBriefingProps {
  title: string;
  briefing?: string | null;
  emptyLabel: string;
  editHref?: string;
  editLabel?: string;
  emptyActionLabel?: string;
  showMoreLabel: string;
  showLessLabel: string;
}

export function ProjectBriefing({
  title,
  briefing,
  emptyLabel,
  editHref,
  editLabel,
  emptyActionLabel,
  showMoreLabel,
  showLessLabel,
}: ProjectBriefingProps) {
  const content = briefing?.trim() || null;
  const isLong = Boolean(
    content && content.length > BRIEFING_COLLAPSE_CHAR_THRESHOLD,
  );
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="space-y-2" data-testid="project-briefing">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {title}
        </h2>
        {editHref && editLabel ? (
          <Link
            href={editHref}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {editLabel}
          </Link>
        ) : null}
      </div>
      {content ? (
        <div className="space-y-2">
          <div
            id="project-briefing-content"
            data-testid="project-briefing-content"
            className={cn(
              "text-foreground/80",
              isLong && !expanded && "max-h-64 overflow-hidden",
            )}
          >
            <Markdown>{content}</Markdown>
          </div>
          {isLong ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls="project-briefing-content"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? showLessLabel : showMoreLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground/60 text-sm">{emptyLabel}</p>
          {editHref && emptyActionLabel ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={editHref}>{emptyActionLabel}</Link>
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
