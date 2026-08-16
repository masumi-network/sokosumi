"use client";

import Link from "next/link";
import { useState } from "react";

import { BRIEFING_COLLAPSE_CHAR_THRESHOLD } from "@/app/projects/project-briefing";
import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

interface ProjectBriefingProps {
  title: string;
  briefing?: string | null;
  emptyLabel: string;
  editHref?: string;
  editLabel?: string;
  showMoreLabel: string;
  showLessLabel: string;
}

export function ProjectBriefing({
  title,
  briefing,
  emptyLabel,
  editHref,
  editLabel,
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
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? showLessLabel : showMoreLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground/40 text-sm">{emptyLabel}</p>
      )}
    </section>
  );
}
