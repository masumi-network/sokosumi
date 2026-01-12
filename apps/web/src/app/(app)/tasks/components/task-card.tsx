import Link from "next/link";

import { type TaskCardData } from "@/app/tasks/types";
import { AgentJobStatusBadge } from "@/components/jobs/agent-job-status-badge";
import { Card, CardContent } from "@/components/ui/card";

import { BudgetSummary, TaskMetaDetails, TaskPrimaryAgent } from "./task-meta";

interface TaskCardLabels {
  budget: string;
}

interface TaskCardProps {
  task: TaskCardData;
  labels: TaskCardLabels;
}

export function TaskCard({ task, labels }: TaskCardProps) {
  return (
    <Link href={`/tasks/${task.id}`} className="block">
      <Card className="hover:bg-foreground/5 py-4">
        <CardContent className="space-y-2 px-4">
          <div className="space-y-2">
            <h3 className="text-lg leading-tight font-semibold">
              {task.title}
            </h3>
            <AgentJobStatusBadge
              status={task.status}
              className="rounded-full text-xs font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TaskPrimaryAgent agent={task.agents[0]} className="text-sm" />
            <BudgetSummary
              budgetLabel={labels.budget}
              budget={task.budget}
              className="justify-end"
            />
          </div>

          <TaskMetaDetails
            orchestrator={task.orchestrator}
            commentsCount={task.commentsCount}
            date={task.date}
            variant="card"
          />
        </CardContent>
      </Card>
    </Link>
  );
}
