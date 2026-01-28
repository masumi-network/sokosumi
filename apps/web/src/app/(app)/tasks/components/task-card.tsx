import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { type TaskWithOrchestrator } from "@/lib/types/task";

import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskCardProps {
  task: TaskWithOrchestrator;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <Link href={`/tasks/${task.id}`} className="block">
      <Card className="hover:bg-foreground/5 py-4">
        <CardContent className="space-y-2 px-4">
          <div className="space-y-2">
            <h3 className="text-lg leading-tight font-semibold">{task.name}</h3>
            <TaskStatusBadge
              status={task.status}
              className="rounded-full text-xs font-medium"
            />
          </div>

          <p className="text-muted-foreground line-clamp-2 text-sm">
            {task.descriptionPlain ?? task.description ?? "—"}
          </p>

          <TaskMetaDetails
            orchestrator={task.orchestrator}
            commentsCount={task.commentsCount}
            createdAt={task.createdAt}
            variant="card"
          />
        </CardContent>
      </Card>
    </Link>
  );
}
