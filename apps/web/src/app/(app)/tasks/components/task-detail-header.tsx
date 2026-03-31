import type { MemberWithOrganization } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import type { TaskLink } from "@/lib/clients/generated/core/types.gen";
import type { CoworkerOption } from "@/lib/types/coworker";
import { type TaskWithCoworker } from "@/lib/types/task";

import { TaskDetailActions } from "./task-detail-actions";
import { TASK_STATUS } from "./task-detail-api-types";

interface TaskDetailHeaderProps {
  task: TaskWithCoworker;
  taskLinks: TaskLink[];
  coworkerOptions: CoworkerOption[];
  agentNameById: Map<string, string>;
  defaultCoworkerId?: string | null;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
  /** Shown when moving a task to the personal workspace (e.g. user name). */
  personalWorkspaceLabel: string;
  labels: {
    back: string;
    actionsMenuLabel: string;
    actions: {
      edit: string;
      delete: string;
      confirmDelete: string;
      confirmDeleteDescription: string;
      deleteError: string;
      markAsReady: string;
      revertToDraft: string;
      cancelRequest: string;
      share: string;
    };
  };
}

export function TaskDetailHeader({
  task,
  taskLinks,
  coworkerOptions,
  agentNameById,
  defaultCoworkerId,
  currentOrganizationId,
  organizations,
  personalWorkspaceLabel,
  labels,
}: TaskDetailHeaderProps) {
  const canManage =
    task.status === TASK_STATUS.DRAFT ||
    task.status === TASK_STATUS.READY ||
    task.status === TASK_STATUS.INPUT_REQUIRED ||
    task.status === TASK_STATUS.AUTHENTICATION_REQUIRED ||
    task.status === TASK_STATUS.OUT_OF_CREDITS ||
    task.status === TASK_STATUS.CREDITS_TOPPED_UP ||
    task.status === TASK_STATUS.RUNNING ||
    task.status === TASK_STATUS.AWAITING_EXTERNAL ||
    task.status === TASK_STATUS.COMPLETED ||
    task.status === TASK_STATUS.FAILED ||
    task.status === TASK_STATUS.CANCEL_REQUESTED ||
    task.status === TASK_STATUS.CANCELED;

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
            share={task.share ?? null}
            taskId={task.id}
            status={task.status}
            jobsCount={task.jobsCount}
            taskLinks={taskLinks}
            coworkerOptions={coworkerOptions}
            agentNameById={agentNameById}
            defaultCoworkerId={defaultCoworkerId}
            actionsMenuLabel={labels.actionsMenuLabel}
            labels={labels.actions}
            currentOrganizationId={currentOrganizationId}
            organizations={organizations}
            personalWorkspaceLabel={personalWorkspaceLabel}
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
