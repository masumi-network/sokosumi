import { TaskStatus } from "@sokosumi/core-client";
import type { TaskAssigneeKind } from "@sokosumi/utils";

export interface TaskDetailActionsLabels {
  edit: string;
  archive: string;
  archiveError: string;
  reopenToReady: string;
  reopenToReadyCommentRequired: string;
  cancel: string;
  share: string;
  startWorking: string;
  pauseToReady: string;
  waitExternal: string;
  resumeRunning: string;
  resumeReady: string;
  markComplete: string;
}

export interface TaskStatusAction {
  label: string;
  target: TaskStatus;
  requiresComment?: boolean;
}

/** The status moves the detail header offers for this status and assignee. */
export function getTaskStatusActions(
  status: TaskStatus,
  labels: TaskDetailActionsLabels,
  options: {
    assigneeKind?: TaskAssigneeKind;
  },
): TaskStatusAction[] {
  const isHuman =
    options.assigneeKind === "human" || options.assigneeKind === "unset";

  if (status === TaskStatus.DRAFT) {
    return [];
  }

  if (status === TaskStatus.READY) {
    if (isHuman) {
      return [{ label: labels.startWorking, target: TaskStatus.RUNNING }];
    }
    return [];
  }

  if (status === TaskStatus.RUNNING && isHuman) {
    return [
      { label: labels.markComplete, target: TaskStatus.COMPLETED },
      { label: labels.waitExternal, target: TaskStatus.AWAITING_EXTERNAL },
      { label: labels.pauseToReady, target: TaskStatus.READY },
      { label: labels.cancel, target: TaskStatus.CANCELED },
    ];
  }

  if (status === TaskStatus.AWAITING_EXTERNAL && isHuman) {
    return [
      { label: labels.resumeRunning, target: TaskStatus.RUNNING },
      { label: labels.markComplete, target: TaskStatus.COMPLETED },
      { label: labels.resumeReady, target: TaskStatus.READY },
      { label: labels.cancel, target: TaskStatus.CANCELED },
    ];
  }

  if (
    status === TaskStatus.QUEUED ||
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
    status === TaskStatus.AUTHENTICATION_REQUIRED ||
    status === TaskStatus.OUT_OF_CREDITS ||
    status === TaskStatus.CREDITS_TOPPED_UP ||
    status === TaskStatus.RUNNING ||
    status === TaskStatus.AWAITING_EXTERNAL
  ) {
    return [
      {
        label: labels.cancel,
        target: TaskStatus.CANCELED,
      },
    ];
  }

  // Unset Ready is valid (SOK-868). A Coworker or Soko Bot Task needs a
  // comment to reopen, since its assignee starts a new run (SOKD-279).
  if (status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED) {
    return [
      {
        label: labels.reopenToReady,
        target: TaskStatus.READY,
        requiresComment: !isHuman,
      },
    ];
  }

  return [];
}
