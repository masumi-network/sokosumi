import Link from "next/link";

import { HistoryTypeColumn } from "@/app/history/components/history-list-item";
import { getHistoryItemHref } from "@/app/history/utils/history-item-href";
import { ProjectResourceCountPills } from "@/app/projects/components/project-resource-count-pills";
import {
  PROJECTS_BROWSE_DIVIDE_CLASS,
  PROJECTS_BROWSE_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeAgo } from "@/components/time-ago";
import { type HistoryItem, TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

export interface ProjectNeedsAttentionLabels {
  needsAttention: string;
  empty: string;
  viewAllTasks: string;
  viewAllJobs: string;
  counts: {
    tasks: string;
    jobs: string;
  };
  kind: {
    task: string;
    job: string;
  };
  taskStatus: Record<TaskStatus, string>;
  locale: string;
}

interface ProjectNeedsAttentionSectionProps {
  projectId: string;
  taskCount: number;
  jobCount: number;
  items: HistoryItem[];
  labels: ProjectNeedsAttentionLabels;
}

export function ProjectNeedsAttentionSection({
  projectId,
  taskCount,
  jobCount,
  items,
  labels,
}: ProjectNeedsAttentionSectionProps) {
  return (
    <section className="space-y-4" data-testid="project-needs-attention">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {labels.needsAttention}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <ProjectResourceCountPills
            taskCount={taskCount}
            jobCount={jobCount}
            labels={labels.counts}
          />
          <nav className="flex items-center gap-3">
            <Link
              href={`/tasks?projectId=${projectId}`}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              {labels.viewAllTasks}
            </Link>
            <Link
              href={`/tasks?projectId=${projectId}&tab=jobs`}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              {labels.viewAllJobs}
            </Link>
          </nav>
        </div>
      </div>

      <div className={PROJECTS_BROWSE_LAYOUT_CLASS}>
        {items.length === 0 ? (
          <div className="text-muted-foreground/50 flex items-center justify-center py-16 text-sm">
            {labels.empty}
          </div>
        ) : (
          <ul className={PROJECTS_BROWSE_DIVIDE_CLASS}>
            {items.map((item) => (
              <ProjectNeedsAttentionRow
                key={`${item.kind}:${item.id}`}
                item={item}
                labels={labels}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ProjectNeedsAttentionRow({
  item,
  labels,
}: {
  item: HistoryItem;
  labels: ProjectNeedsAttentionLabels;
}) {
  const href = getHistoryItemHref(item) ?? "/tasks";

  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3",
          "-mx-2 rounded-lg px-4 py-3 transition-colors",
          "hover:bg-muted/50 active:scale-[0.995]",
        )}
      >
        <HistoryTypeColumn item={item} labels={{ kind: labels.kind }} />
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          {item.title}
        </span>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {item.kind === "task" ? (
            <TaskStatusBadge
              status={item.status}
              label={labels.taskStatus[item.status]}
              className="w-fit shrink-0 rounded-sm"
            />
          ) : (
            <JobStatusBadge status={item.status} className="shrink-0" />
          )}
          <span className="text-muted-foreground shrink-0">
            <TimeAgo date={item.updatedAt} locale={labels.locale} />
          </span>
        </div>
      </Link>
    </li>
  );
}
