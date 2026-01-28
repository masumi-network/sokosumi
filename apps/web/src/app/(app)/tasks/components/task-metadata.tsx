import { TaskWithOrchestrator } from "@/lib/types/task";

import { TaskStatusBadge } from "./task-status-badge";

interface TaskMetadataLabels {
  status: string;
  orchestrator: string;
}

interface TaskMetadataProps {
  task: TaskWithOrchestrator;
  labels: TaskMetadataLabels;
}

export function TaskMetadata({ task, labels }: TaskMetadataProps) {
  const rows = [
    {
      key: "status",
      label: labels.status,
      value: (
        <TaskStatusBadge
          status={task.status}
          className="rounded-full px-3 py-1 text-xs font-semibold"
        />
      ),
    },
    {
      key: "orchestrator",
      label: labels.orchestrator,
      value: (
        <span className="text-sm font-medium">
          {task.orchestrator?.name ?? "—"}
        </span>
      ),
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
