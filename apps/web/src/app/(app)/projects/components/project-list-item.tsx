import Link from "next/link";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  type ProjectResourceCountPillLabels,
  ProjectResourceCountPills,
} from "@/app/projects/components/project-resource-count-pills";
import { PROJECTS_LIST_ROW_LAYOUT_CLASS } from "@/app/projects/constants";
import { TimeAgo } from "@/components/time-ago";
import { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

interface ProjectListItemLabels {
  counts: ProjectResourceCountPillLabels;
  lastActivity: string;
  created: string;
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
    <article className={PROJECTS_LIST_ROW_LAYOUT_CLASS}>
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-row items-center gap-4 rounded-none px-2 py-3 transition-colors",
          "hover:bg-card-background-hover active:scale-[0.995] md:rounded-lg",
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
    </article>
  );
}
