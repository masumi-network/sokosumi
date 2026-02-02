import { TaskStatus } from "@sokosumi/database";

import type { AuthenticationContext } from "@/middleware/auth";
import type { TaskWithIncludes } from "@/types/task";

import { unprocessableEntity } from "./error";

function getAllowedTransitions(
  authContext: AuthenticationContext,
): Record<TaskStatus, TaskStatus[]> {
  if (authContext.orchestratorId) {
    return {
      [TaskStatus.DRAFT]: [],
      [TaskStatus.READY]: [TaskStatus.RUNNING],
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
  }

  if (authContext.userId) {
    return {
      [TaskStatus.DRAFT]: [TaskStatus.READY],
      [TaskStatus.READY]: [TaskStatus.DRAFT],
      [TaskStatus.INPUT_REQUIRED]: [],
      [TaskStatus.RUNNING]: [],
      [TaskStatus.COMPLETED]: [],
      [TaskStatus.FAILED]: [],
    };
  }

  throw unprocessableEntity("Invalid authentication context");
}

export function validateStatusTransition(
  authContext: AuthenticationContext,
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (from === to) {
    throw unprocessableEntity("Invalid status transition: same status");
  }

  const allowedTransitions = getAllowedTransitions(authContext);
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
    jobIds: task.jobs.map((j) => j.id),
  };
}
