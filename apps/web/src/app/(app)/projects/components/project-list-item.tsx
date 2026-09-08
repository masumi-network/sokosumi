import Link from "next/link";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  type ProjectResourceCountPillLabels,
  ProjectResourceCountPills,
} from "@/app/projects/components/project-resource-count-pills";
import { PROJECTS_LIST_ROW_LAYOUT_CLASS } from "@/app/projects/constants";
import { previewProjectBriefing } from "@/app/projects/project-briefing";
import { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

interface ProjectListItemLabels {
  counts: ProjectResourceCountPillLabels;
}

interface ProjectListItemProps {
  project: ProjectListItemType;
  labels: ProjectListItemLabels;
}

export function ProjectListItem({ project, labels }: ProjectListItemProps) {
  const briefing = previewProjectBriefing(project.briefing);

  return (
    <article className={PROJECTS_LIST_ROW_LAYOUT_CLASS}>
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-row items-center gap-4 rounded-none px-2 py-3 transition-colors",
          "hover:bg-muted/50 active:scale-[0.995] md:rounded-lg",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ProjectAvatar name={project.name} logo={project.logo} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {project.name}
            </span>
            <p className="text-muted-foreground/70 line-clamp-1 text-xs break-all">
              {briefing}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <ProjectResourceCountPills
            taskCount={project.taskCount}
            jobCount={project.jobCount}
            labels={labels.counts}
          />
        </div>
      </Link>
    </article>
  );
}
