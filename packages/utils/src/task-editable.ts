import { USER_TRANSITION_TASK_STATUSES } from "./task-status-transitions.js";

/**
 * Task statuses whose metadata (name, description, project, coworker) may be
 * edited by the owner. Values match the Prisma `TaskStatus` enum in
 * `@sokosumi/database`.
 */
export const TASK_EDITABLE_STATUSES = [
  "DRAFT",
  "QUEUED",
  "READY",
] as const satisfies readonly (typeof USER_TRANSITION_TASK_STATUSES)[number][];

export type TaskEditableStatus = (typeof TASK_EDITABLE_STATUSES)[number];

export function isTaskEditableStatus(
  status: string,
): status is TaskEditableStatus {
  return (TASK_EDITABLE_STATUSES as readonly string[]).includes(status);
}
