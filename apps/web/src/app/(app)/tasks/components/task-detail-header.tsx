import { TaskStatus } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { type TaskWithCoworker } from "@/lib/types/task";

import { TaskDetailActions } from "./task-detail-actions";

interface TaskDetailHeaderProps {
  task: TaskWithCoworker;
  labels: {
    back: string;
    actions: {
      edit: string;
      delete: string;
      confirmDelete: string;
      confirmDeleteDescription: string;
      deleteError: string;
      markAsReady: string;
      revertToDraft: string;
    };
  };
}

export function TaskDetailHeader({ task, labels }: TaskDetailHeaderProps) {
  const canEdit =
    task.status === TaskStatus.DRAFT || task.status === TaskStatus.READY;

  return (
    <div className="space-y-4">
      {/* Top bar with back and actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          <span>{labels.back}</span>
        </Link>

        {canEdit ? (
          <TaskDetailActions
            taskId={task.id}
            status={task.status}
            labels={labels.actions}
          />
        ) : null}
      </div>

      {/* Title */}
      <h1 className="text-xl font-semibold leading-tight tracking-tight">
        {task.name}
      </h1>
    </div>
  );
}
