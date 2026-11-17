import type { Project } from "@sokosumi/core-client";
import { Flag } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  PROJECTS_BROWSE_CARD_CLASS,
  PROJECTS_CARD_CLASS,
} from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

export interface FeaturedProjectLabels {
  heading: string;
  /** The mark on the featured Project's own card in the grid. */
  badge: string;
  open: string;
}

/**
 * The Project an owner or admin featured for every member, above the grid.
 * Its own panel, so the grid keeps its activity order and the reader's Pins.
 */
export function FeaturedProjectCard({
  project,
  labels,
}: {
  project: Project;
  labels: FeaturedProjectLabels;
}) {
  const headingId = useId();
  const briefing = stripMarkdownToText(project.briefing);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="featured-project"
      className={cn(PROJECTS_BROWSE_CARD_CLASS, "flex flex-col gap-2")}
    >
      <h2
        id={headingId}
        className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 text-xs font-medium"
      >
        <Flag aria-hidden className="size-3.5" />
        {labels.heading}
      </h2>
      <div
        className={cn(
          PROJECTS_CARD_CLASS,
          "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ProjectAvatar name={project.name} logo={project.logo} />
          <div className="min-w-0 flex-1">
            <p className="text-foreground line-clamp-1 text-sm font-medium">
              {project.name}
            </p>
            {briefing ? (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm wrap-anywhere">
                {briefing}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          className="shrink-0 self-start sm:self-center"
        >
          <Link href={`/projects/${project.id}`}>
            {labels.open}
            <span className="sr-only"> {project.name}</span>
          </Link>
        </Button>
      </div>
    </section>
  );
}
