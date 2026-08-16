import { Briefcase, ListTodo } from "lucide-react";
import { getTaskStatusDotColorClass } from "@/app/tasks/components/task-status-badge";
import type {
  ProjectStatsEntry,
  ProjectTaskStatusCount,
} from "@/lib/clients/generated/core/types.gen";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

type ProjectTaskStatus = ProjectTaskStatusCount["status"];

export interface ProjectStatsSummaryLabels {
  tasks: string;
  jobs: string;
  taskStatusLabels: Record<ProjectTaskStatus, string>;
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

  return (
    <div className="contents">
      <div className="bg-muted/30 border-border/50 rounded-xl border p-4">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <ListTodo className="size-4" aria-hidden />
          <span>{labels.tasks}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {taskTotal}
        </p>
        <StatusBreakdown chips={taskChips} />
      </div>
      <div className="bg-muted/30 border-border/50 rounded-xl border p-4">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <Briefcase className="size-4" aria-hidden />
          <span>{labels.jobs}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {jobTotal}
        </p>
      </div>
    </div>
  );
}

function StatusBreakdown({ chips }: { chips: StatusChip[] }) {
  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="text-muted-foreground inline-flex items-center gap-1 tabular-nums"
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

function getTopStatusCounts<TStatus extends string>(
  counts: Array<{ status: TStatus; count: number }>,
) {
  return counts
    .filter((entry) => entry.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 3);
}
