import Link from "next/link";

import {
  getHistoryItemHref,
  HistoryTypeColumn,
} from "@/app/history/components/history-list-item";
import { ProjectResourceCountPills } from "@/app/projects/components/project-resource-count-pills";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeAgo } from "@/components/time-ago";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { HistoryItem } from "@/lib/services/history.service";
import type { SokosumiJobStatus } from "@/lib/types/core-dto";

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
        <h2 className="text-foreground text-sm font-medium">
          {labels.needsAttention}
        </h2>
        <ProjectResourceCountPills
          taskCount={taskCount}
          jobCount={jobCount}
          labels={labels.counts}
        />
      </div>

      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          href={`/tasks?projectId=${projectId}`}
          className="text-primary font-medium hover:underline"
        >
          {labels.viewAllTasks}
        </Link>
        <Link
          href={`/tasks?projectId=${projectId}&tab=jobs`}
          className="text-primary font-medium hover:underline"
        >
          {labels.viewAllJobs}
        </Link>
      </nav>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.empty}</p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {items.map((item) => (
            <ProjectNeedsAttentionRow
              key={`${item.kind}:${item.id}`}
              item={item}
              labels={labels}
            />
          ))}
        </ul>
      )}
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
        className="hover:bg-muted/50 active:scale-[0.995] flex items-center gap-3 px-3 py-3 transition-colors"
      >
        <HistoryTypeColumn item={item} labels={{ kind: labels.kind }} />
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          {item.title}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          {item.kind === "task" ? (
            <TaskStatusBadge
              status={item.status as TaskStatus}
              label={labels.taskStatus[item.status as TaskStatus]}
            />
          ) : (
            <JobStatusBadge status={item.status as SokosumiJobStatus} />
          )}
          <span className="text-muted-foreground text-xs tabular-nums">
            <TimeAgo date={item.updatedAt} locale={labels.locale} />
          </span>
        </div>
      </Link>
    </li>
  );
}
