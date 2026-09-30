import { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import Link from "next/link";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { ProjectPinButton } from "@/app/projects/components/project-pin-button";
import {
  type ProjectResourceCountPillLabels,
  ProjectResourceCountPills,
} from "@/app/projects/components/project-resource-count-pills";
import {
  PROJECTS_LIST_ROW_CARD_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { TimeAgo } from "@/components/time-ago";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

interface ProjectListItemLabels {
  counts: ProjectResourceCountPillLabels;
  lastActivity: string;
  created: string;
  pin: string;
  unpin: string;
  pinError: string;
}

interface ProjectListItemProps {
  project: ProjectListItemType;
  labels: ProjectListItemLabels;
}

export function ProjectListItem({ project, labels }: ProjectListItemProps) {
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

  return (
    // The Pin button cannot live inside the link — a button nested in an
    // anchor is invalid and the click would navigate instead of pinning — so
    // the row becomes a flex pair: the link takes the space, the button sits
    // beside it and keeps its own hit area.
    <article
      className={cn(
        PROJECTS_LIST_ROW_LAYOUT_CLASS,
        PROJECTS_LIST_ROW_CARD_CLASS,
        "hover:bg-card-background-hover flex flex-row items-center pr-2 transition-[background-color]",
        // The link stops short of the Pin button, so its own outline would cut
        // a line through the card. The ring goes around the whole row instead.
        // Forced colors drop box-shadow and the row's paint containment clips
        // the link's outline, so a transparent outline on the row carries
        // focus there; the system colour paints it.
        "has-[>a:focus-visible]:ring-ring has-[>a:focus-visible]:ring-2",
        "has-[>a:focus-visible]:outline-2 has-[>a:focus-visible]:outline-transparent",
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-stretch gap-2 rounded-lg px-4 py-3 outline-hidden sm:flex-row sm:items-center sm:gap-4",
          "press content-in",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ProjectAvatar name={project.name} logo={project.logo} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {project.name}
            </span>
            {briefing ? (
              <p className="text-muted-foreground line-clamp-1 text-xs break-all">
                {briefing}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ProjectResourceCountPills
            taskCount={project.taskCount}
            jobCount={project.jobCount}
            labels={labels.counts}
          />
          <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
            {isUntouched ? `${labels.created} ` : null}
            <TimeAgo
              date={project.lastActivityAt}
              titlePrefix={isUntouched ? labels.created : labels.lastActivity}
            />
          </span>
        </div>
      </Link>

      <ProjectPinButton
        projectId={project.id}
        isPinned={project.starredAt != null}
        isClosed={project.closingAt != null || project.closedAt != null}
        labels={{
          pin: labels.pin,
          unpin: labels.unpin,
          error: labels.pinError,
        }}
      />
    </article>
  );
}
