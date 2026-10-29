import { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import { Pin } from "lucide-react";
import Link from "next/link";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  ProjectDetailActions,
  type ProjectDetailActionsLabels,
} from "@/app/projects/components/project-detail-actions";
import {
  type ProjectResourceCountPillLabels,
  ProjectResourceCountPills,
} from "@/app/projects/components/project-resource-count-pills";
import {
  PROJECTS_CARD_CLASS,
  PROJECTS_CARD_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

interface ProjectListItemLabels {
  counts: ProjectResourceCountPillLabels;
  lastActivity: string;
  created: string;
  /** Read out beside a Pinned card's name; the mark itself is an icon. */
  pinned: string;
  closed: string;
  /** The project menu without Edit: a card opens the project to edit it. */
  actions: Omit<ProjectDetailActionsLabels, "edit">;
}

interface ProjectListItemProps {
  project: ProjectListItemType;
  labels: ProjectListItemLabels;
  /** The card sits in the Hidden view: no Pin, and its menu offers Show. */
  hidden?: boolean;
}

export function ProjectListItem({
  project,
  labels,
  hidden = false,
}: ProjectListItemProps) {
  const briefing = stripMarkdownToText(project.briefing);
  // Core floors lastActivityAt at createdAt (GREATEST(p."createdAt", …)), so
  // an equal pair means nothing has happened in the project yet. Calling that
  // "active" would be a lie, and a bare stamp would be read as one.
  // Exact equality holds because both sides are the same column value at the
  // same precision; if Core ever rounds or recomputes the floor, this silently
  // falls back to the plain activity stamp rather than breaking.
  const isUntouched =
    new Date(project.lastActivityAt).getTime() ===
    new Date(project.createdAt).getTime();
  // Only a finished close counts: closing and close-failed projects stay Open.
  const closedAt = project.closedAt;
  // A Closed card shows no Pin: the Closed view never sorts by one. A Hidden
  // project has none, since hiding unpinned it.
  const isPinned = !closedAt && project.starredAt != null;

  return (
    // The card holds the link and the menu side by side: the link fills the
    // card, the menu sits over its top-right corner.
    <article
      className={cn(
        PROJECTS_CARD_LAYOUT_CLASS,
        PROJECTS_CARD_CLASS,
        "group/card hover:bg-card-background-hover relative flex flex-col transition-[background-color]",
        // The link stops short of the menu button, so its own outline would cut
        // a line through the card. The ring goes around the whole card instead.
        // Forced colors drop box-shadow and the card's paint containment clips
        // the link's outline, so a transparent outline on the card carries
        // focus there; the system colour paints it.
        "has-[>a:focus-visible]:ring-ring has-[>a:focus-visible]:ring-2",
        "has-[>a:focus-visible]:outline-2 has-[>a:focus-visible]:outline-transparent",
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 rounded-lg p-4 outline-hidden",
          "press content-in",
        )}
      >
        {/* Clear of the menu button in the top-right corner. The Pin mark
            follows the name, so a Pinned card reads as one at a glance. */}
        <div className="flex min-w-0 items-center gap-3 pe-8">
          <ProjectAvatar name={project.name} logo={project.logo} />
          <span className="text-foreground line-clamp-1 min-w-0 text-sm font-medium">
            {project.name}
          </span>
          {isPinned ? (
            <span
              data-testid="project-pinned-mark"
              className="text-foreground -ms-1.5 shrink-0"
            >
              <Pin aria-hidden className="size-3.5 fill-current" />
              <span className="sr-only">{labels.pinned}</span>
            </span>
          ) : null}
        </div>

        {briefing ? (
          <p className="text-muted-foreground line-clamp-2 text-sm wrap-anywhere">
            {briefing}
          </p>
        ) : null}

        <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
          <ProjectResourceCountPills
            taskCount={project.taskCount}
            jobCount={project.jobCount}
            labels={labels.counts}
          />
          {closedAt ? (
            <span className="text-muted-foreground ms-auto flex shrink-0 items-center gap-2 text-xs whitespace-nowrap">
              <Badge variant="secondary">{labels.closed}</Badge>
              <TimeAgo date={closedAt} titlePrefix={labels.closed} />
            </span>
          ) : (
            <span className="text-muted-foreground ms-auto shrink-0 text-xs whitespace-nowrap">
              {isUntouched ? `${labels.created} ` : null}
              <TimeAgo
                date={project.lastActivityAt}
                titlePrefix={isUntouched ? labels.created : labels.lastActivity}
              />
            </span>
          )}
        </div>
      </Link>

      {/* A Closed card has no menu: a Closed project lists there Hidden or
          not, and the project header still offers Unpin and Show for what a
          close left. The menu cannot live inside the link (a button in an
          anchor is invalid and the click would navigate), so it sits over the
          card's top-right corner with its own hit area. */}
      {closedAt ? null : (
        <ProjectDetailActions
          projectId={project.id}
          projectRevision={project.projectRevision}
          isClosingOrClosed={project.closingAt != null}
          isHidden={hidden}
          isPinned={isPinned}
          labels={labels.actions}
          triggerClassName={cn(
            "text-muted-foreground hover:text-foreground absolute end-2 top-2 size-8 rounded-full md:size-8",
            // 44px hit area: the card behind is a link, so a near miss on a
            // phone would open the project.
            "before:absolute before:-inset-1.5 before:content-['']",
            // Revealed on hover or focus where a pointer can hover; touch
            // keeps it visible.
            "pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100 data-[state=open]:opacity-100",
          )}
        />
      )}
    </article>
  );
}
