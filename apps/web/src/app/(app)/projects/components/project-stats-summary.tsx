import type { TaskStatus } from "@sokosumi/utils";
import type { LucideIcon } from "lucide-react";
import { ListTodo, Sparkles } from "lucide-react";
import { getTaskStatusDotColorClass } from "@/app/tasks/components/task-status-badge";
import type {
  ProjectJobStatusCount,
  ProjectStatsEntry,
  ProjectTaskStatusCount,
} from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

type ProjectTaskStatus = ProjectTaskStatusCount["status"];
type ProjectJobStatus = ProjectJobStatusCount["status"];

export interface ProjectStatsSummaryLabels {
  tasks: string;
  jobs: string;
  taskStatusLabels: Record<ProjectTaskStatus, string>;
  jobStatusLabels: Record<ProjectJobStatus, string>;
}

interface ProjectStatsSummaryProps {
  stats?: ProjectStatsEntry;
  labels: ProjectStatsSummaryLabels;
}

interface StatusChip {
  key: string;
  label: string;
  count: number;
  dotClassName: string;
}

export function ProjectStatsSummary({
  stats,
  labels,
}: ProjectStatsSummaryProps) {
  const taskTotal = stats?.tasks.total ?? 0;
  const jobTotal = stats?.jobs.total ?? 0;
  const taskChips = getTaskStatusChips(stats, labels);
  const jobChips = getJobStatusChips(stats, labels);

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
      <ResourceStatsLine
        icon={ListTodo}
        ariaLabel={labels.tasks}
        total={taskTotal}
        chips={taskChips}
      />
      <ResourceStatsLine
        icon={Sparkles}
        ariaLabel={labels.jobs}
        total={jobTotal}
        chips={jobChips}
      />
    </div>
  );
}

function ResourceStatsLine({
  icon: Icon,
  ariaLabel,
  total,
  chips,
}: {
  icon: LucideIcon;
  ariaLabel: string;
  total: number;
  chips: StatusChip[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span
        className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
        aria-label={`${ariaLabel}: ${total}`}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {total}
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="border-border/50 bg-background/80 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground"
        >
          <span
            className={cn("size-1.5 rounded-full", chip.dotClassName)}
            aria-hidden
          />
          {chip.label} {chip.count}
        </span>
      ))}
    </div>
  );
}

function getTaskStatusChips(
  stats: ProjectStatsEntry | undefined,
  labels: ProjectStatsSummaryLabels,
): StatusChip[] {
  return getTopStatusCounts(stats?.tasks.byStatus ?? []).map((entry) => ({
    key: entry.status,
    label: labels.taskStatusLabels[entry.status],
    count: entry.count,
    dotClassName: getTaskStatusDotColorClass(entry.status as TaskStatus),
  }));
}

function getJobStatusChips(
  stats: ProjectStatsEntry | undefined,
  labels: ProjectStatsSummaryLabels,
): StatusChip[] {
  return getTopStatusCounts(stats?.jobs.byStatus ?? []).map((entry) => ({
    key: entry.status,
    label: labels.jobStatusLabels[entry.status],
    count: entry.count,
    dotClassName: getJobStatusDotColorClass(entry.status),
  }));
}

function getTopStatusCounts<TStatus extends string>(
  counts: Array<{ status: TStatus; count: number }>,
) {
  return counts
    .filter((entry) => entry.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 3);
}

function getJobStatusDotColorClass(status: ProjectJobStatus): string {
  switch (status) {
    case "completed":
    case "refund_resolved":
    case "dispute_resolved":
      return "bg-green-500";
    case "failed":
    case "payment_failed":
      return "bg-red-500";
    case "input_required":
      return "bg-yellow-500";
    case "refund_pending":
    case "dispute_pending":
      return "bg-orange-500";
    case "started":
    case "payment_pending":
    case "processing":
    case "result_pending":
      return "bg-sky-500";
  }
}
