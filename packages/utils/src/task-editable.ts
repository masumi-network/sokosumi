import { USER_TRANSITION_TASK_STATUSES } from "./task-status-transitions.js";

/**
 * Task statuses whose metadata (name, description, project, coworker) may be
 * edited by the owner. Values match the Prisma `TaskStatus` enum in
 * `@sokosumi/database`.
 */
const editableStatuses = [
  "DRAFT",
  "QUEUED",
  "READY",
] as const satisfies readonly (typeof USER_TRANSITION_TASK_STATUSES)[number][];

export const TASK_EDITABLE_STATUSES = USER_TRANSITION_TASK_STATUSES.filter(
  (status): status is (typeof editableStatuses)[number] =>
    (editableStatuses as readonly string[]).includes(status),
);

export type TaskEditableStatus = (typeof TASK_EDITABLE_STATUSES)[number];

export function isTaskEditableStatus(
  status: string,
): status is TaskEditableStatus {
  return (TASK_EDITABLE_STATUSES as readonly string[]).includes(status);
}
