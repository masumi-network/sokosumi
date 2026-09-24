import { TaskStatus } from "@sokosumi/database";
import { isAgentOnlyTaskStatus } from "@sokosumi/utils";

import {
  type AuthenticationContext,
  isAgentAuthContext,
} from "@/middleware/auth";

/** Display order for the status picker; mirrors the web board's column order. */
const TASK_STATUS_ORDER = [
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.RUNNING,
  TaskStatus.AWAITING_EXTERNAL,
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
] as const satisfies readonly TaskStatus[];

/**
 * Statuses a person may set by hand. Everything else is written by the
 * assigned Coworker or Soko Bot, or by Core itself (grants, credits, auth).
 * Input required and Approval required are the Coworker asking the person for
 * something, so a person cannot put a Task there.
 */
const PERSON_SELECTABLE_STATUSES = new Set<TaskStatus>([
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
  TaskStatus.RUNNING,
  TaskStatus.AWAITING_EXTERNAL,
  TaskStatus.COMPLETED,
  TaskStatus.CANCELED,
]);

export interface SelectableStatusesTask {
  status: TaskStatus;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  runAt: Date | string | null;
}

/**
 * Statuses the acting actor may move this Task to right now, in display order
 * and excluding the current one. The status picker renders this list as-is,
 * and `POST /tasks/{id}/events` rejects a non-agent status outside it, so the
 * picker and the write can never disagree (ADR 0029).
 */
export function getSelectableTaskStatuses(
  task: SelectableStatusesTask,
  authContext: AuthenticationContext,
): TaskStatus[] {
  const isAgent = isAgentAuthContext(authContext);
  const hasAgentAssignee =
    task.assigneeId !== null || task.assigneeSokoBotId !== null;

  return TASK_STATUS_ORDER.filter((status) => {
    if (status === task.status) return false;
    if (!isAgent && !PERSON_SELECTABLE_STATUSES.has(status)) return false;
    if (isAgentOnlyTaskStatus(status) && !hasAgentAssignee) return false;
    // Queued waits for a Run at (ADR 0041).
    if (status === TaskStatus.QUEUED) return task.runAt !== null;
    return true;
  });
}
