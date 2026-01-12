import { TAG_COLOR_TOKEN_MAP, TaskCardData } from "@/app/tasks/types";
import { AgentJobStatusBadge } from "@/components/jobs/agent-job-status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/utils/datetime";

interface TaskMetadataLabels {
  status: string;
  assignee: string;
  tags: string;
  dueDate: string;
  budget: string;
  orchestrator: string;
}

interface TaskMetadataProps {
  task: TaskCardData;
  labels: TaskMetadataLabels;
}

export function TaskMetadata({ task, labels }: TaskMetadataProps) {
  const rows = [
    {
      key: "status",
      label: labels.status,
      value: (
        <AgentJobStatusBadge
          status={task.status}
          className="rounded-full px-3 py-1 text-xs font-semibold"
        />
      ),
    },
    {
      key: "assignee",
      label: labels.assignee,
      value: <span className="text-sm font-medium">{task.assignee}</span>,
    },
    {
      key: "tags",
      label: labels.tags,
      value: (
        <div className="flex flex-wrap items-center gap-2">
          {task.tags.map((tag) => (
            <Badge
              key={tag.label}
              variant="secondary"
              className={cn(
                "border-0 px-2 py-0.5 text-xs font-medium",
                TAG_COLOR_TOKEN_MAP[tag.color],
              )}
            >
              {tag.label}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "dueDate",
      label: labels.dueDate,
      value: (
        <span className="text-sm font-medium">
          {formatShortDate(task.dueDate)}
        </span>
      ),
    },
    {
      key: "budget",
      label: labels.budget,
      value: (
        <span className="text-sm font-medium">
          {typeof task.budget === "number" ? `$${task.budget}` : "—"}
        </span>
      ),
    },
    {
      key: "orchestrator",
      label: labels.orchestrator,
      value: <span className="text-sm font-medium">{task.orchestrator}</span>,
    },
  ];

  return (
    <div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 py-2">
            <span className="text-muted-foreground w-26">{row.label}</span>
            <div>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
