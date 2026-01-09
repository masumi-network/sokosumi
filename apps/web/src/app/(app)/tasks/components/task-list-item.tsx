import { type TaskCardData } from "@/app/tasks/types";
import { AgentJobStatusBadge } from "@/components/jobs/agent-job-status-badge";

import { BudgetSummary, TaskMetaDetails, TaskPrimaryAgent } from "./task-meta";

interface TaskListItemProps {
  task: TaskCardData;
  labels: {
    budget: string;
  };
}

export function TaskListItem({ task, labels }: TaskListItemProps) {
  return (
    <div className="bg-card/70 hover:bg-foreground/5 flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{task.title}</span>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            <BudgetSummary budgetLabel={labels.budget} budget={task.budget} />
            <TaskPrimaryAgent agent={task.agents[0]} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-4 text-xs">
        <AgentJobStatusBadge
          status={task.status}
          className="rounded-full font-medium"
        />
        <TaskMetaDetails
          orchestrator={task.orchestrator}
          commentsCount={task.commentsCount}
          date={task.date}
          variant="list"
        />
      </div>
    </div>
  );
}
