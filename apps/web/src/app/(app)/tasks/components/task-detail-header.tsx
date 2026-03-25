import { type MemberWithOrganization, TaskStatus } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { type TaskWithCoworker } from "@/lib/types/task";

import { TaskDetailActions } from "./task-detail-actions";

interface TaskDetailHeaderProps {
  task: TaskWithCoworker;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
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
      cancelRequest: string;
    };
  };
}

export function TaskDetailHeader({
  task,
  currentOrganizationId,
  organizations,
  labels,
}: TaskDetailHeaderProps) {
  const canManage =
    task.status === TaskStatus.DRAFT ||
    task.status === TaskStatus.READY ||
    task.status === TaskStatus.INPUT_REQUIRED ||
    task.status === TaskStatus.AUTHENTICATION_REQUIRED ||
    task.status === TaskStatus.OUT_OF_CREDITS ||
    task.status === TaskStatus.CREDITS_TOPPED_UP ||
    task.status === TaskStatus.RUNNING ||
    task.status === TaskStatus.CANCELED;

  return (
    <div className="space-y-4">
      {/* Top bar with back and actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/tasks"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          <span>{labels.back}</span>
        </Link>

        {canManage ? (
          <TaskDetailActions
            taskId={task.id}
            status={task.status}
            labels={labels.actions}
            currentOrganizationId={currentOrganizationId}
            organizations={organizations}
          />
        ) : null}
      </div>

      {/* Title */}
      <h1 className="text-xl leading-tight font-semibold tracking-tight">
        {task.name}
      </h1>
    </div>
  );
}
