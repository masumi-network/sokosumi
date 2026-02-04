import { TaskStatus } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { type TaskWithOrchestrator } from "@/lib/types/task";

import { TaskDetailActions } from "./task-detail-actions";

interface TaskDetailHeaderProps {
  task: TaskWithOrchestrator;
  labels: {
    back: string;
    actions: {
      edit: string;
      delete: string;
      confirmDelete: string;
      confirmDeleteDescription: string;
      deleteError: string;
    };
  };
}

export function TaskDetailHeader({ task, labels }: TaskDetailHeaderProps) {
  const canEdit =
    task.status === TaskStatus.DRAFT || task.status === TaskStatus.READY;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <Link href="/tasks" aria-label={labels.back}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={labels.back}
            >
              <ArrowLeft className="size-4" />
              <span className="sr-only">{labels.back}</span>
            </Button>
          </Link>

          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl leading-tight font-semibold">
                {task.name}
              </h1>
            </div>
          </div>
        </div>

        {canEdit ? (
          <TaskDetailActions taskId={task.id} labels={labels.actions} />
        ) : null}
      </div>
    </div>
  );
}
