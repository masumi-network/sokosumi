import { TaskStatus } from "@sokosumi/database";

import { unprocessableEntity } from "./error";

export function validateStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (from === to) {
    return;
  }

  const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.DRAFT]: [TaskStatus.READY, TaskStatus.RUNNING],
    [TaskStatus.READY]: [TaskStatus.RUNNING],
    [TaskStatus.RUNNING]: [TaskStatus.COMPLETED, TaskStatus.FAILED],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [],
  };

  if (!allowedTransitions[from].includes(to)) {
    throw unprocessableEntity(
      `Invalid status transition from ${from} to ${to}`,
    );
  }
}
