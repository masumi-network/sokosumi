import { TaskStatus } from "@sokosumi/core-client";

export function isAgentAssigneeFields(fields: {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
}): boolean {
  return fields.assigneeId !== null || fields.assigneeSokoBotId !== null;
}

/** A Run at queues the Task (agents only); otherwise agents start Ready. */
export function resolveStatusForAssigneeAndRunAt(options: {
  isAgent: boolean;
  hasRunAt: boolean;
}): TaskStatus {
  if (options.isAgent) {
    return options.hasRunAt ? TaskStatus.QUEUED : TaskStatus.READY;
  }
  return TaskStatus.DRAFT;
}
