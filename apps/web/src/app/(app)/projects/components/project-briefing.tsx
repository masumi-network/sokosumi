"use client";

import Link from "next/link";
import { CollapsibleSectionMarkdown } from "@/app/projects/components/collapsible-section-markdown";
import { Button } from "@/components/ui/button";

interface ProjectBriefingProps {
  title: string;
  briefing?: string | null;
  emptyLabel: string;
  editHref?: string;
  emptyActionLabel?: string;
  showMoreLabel: string;
  showLessLabel: string;
}

export function ProjectBriefing({
  title,
  briefing,
  emptyLabel,
  editHref,
  emptyActionLabel,
  showMoreLabel,
  showLessLabel,
}: ProjectBriefingProps) {
  const content = briefing?.trim() || null;

  return (
    <section className="space-y-2" data-testid="project-briefing">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      {content ? (
        <CollapsibleSectionMarkdown
          id="project-briefing-content"
          content={content}
          showMoreLabel={showMoreLabel}
          showLessLabel={showLessLabel}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
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
