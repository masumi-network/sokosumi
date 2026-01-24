import { TaskStatus } from "@sokosumi/database";

import type { TaskWithIncludes } from "@/types/task";

import { unprocessableEntity } from "./error";

export function validateStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (from === to) {
    return;
  }

  const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.DRAFT]: [TaskStatus.READY],
    [TaskStatus.READY]: [TaskStatus.DRAFT, TaskStatus.RUNNING],
    [TaskStatus.INPUT_REQUIRED]: [
      TaskStatus.RUNNING,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
    ],
    [TaskStatus.RUNNING]: [
      TaskStatus.INPUT_REQUIRED,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
    ],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [],
  };

  if (!allowedTransitions[from].includes(to)) {
    throw unprocessableEntity(
      `Invalid status transition from ${from} to ${to}`,
    );
  }
}

export function mapTask(task: TaskWithIncludes) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    userId: task.userId,
    orchestratorId: task.orchestratorId ?? null,
    name: task.name,
    description: task.description ?? null,
    status: task.status,
    events: task.events,
  };
}
