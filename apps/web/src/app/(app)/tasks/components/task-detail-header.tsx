import type { MemberWithOrganization } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import type { TaskWithCoworker } from "@/lib/types/task";

import { TaskDetailActions } from "./task-detail-actions";

interface TaskDetailHeaderProps {
  task: TaskWithCoworker;
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
  currentOrganizationId,
  organizations,
  personalWorkspaceLabel,
  labels,
}: TaskDetailHeaderProps) {
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

        <TaskDetailActions
          taskId={task.id}
          share={task.share ?? null}
          status={task.status}
          jobsCount={task.jobsCount}
          actionsMenuLabel={labels.actionsMenuLabel}
          labels={labels.actions}
          currentOrganizationId={currentOrganizationId}
          organizations={organizations}
          personalWorkspaceLabel={personalWorkspaceLabel}
        />
      </div>

      {/* Title */}
      <h1 className="text-xl leading-tight font-semibold tracking-tight">
        {task.name}
      </h1>
    </div>
  );
}
