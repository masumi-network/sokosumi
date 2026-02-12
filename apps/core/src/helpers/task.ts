import { TaskStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import type { AuthenticationContext } from "@/middleware/auth";
import { flattenJob } from "@/types/job";
import type { TaskWithIncludes } from "@/types/task";

import { unprocessableEntity } from "./error";

type TaskEventWithOptionalTransaction = Omit<
  TaskWithIncludes["events"][number],
  "transaction"
> & {
  transaction?: {
    amount: bigint;
  } | null;
};

interface ValidateTaskCoworkerAssignmentParams {
  status: TaskStatus;
  coworkerId: string | null | undefined;
}

function getAllowedTransitions(
  authContext: AuthenticationContext,
): Record<TaskStatus, TaskStatus[]> {
  if (authContext.coworkerId) {
    return {
      [TaskStatus.DRAFT]: [],
      [TaskStatus.READY]: [
        TaskStatus.RUNNING,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.INPUT_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.RUNNING]: [
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.COMPLETED]: [],
      [TaskStatus.FAILED]: [],
      [TaskStatus.CANCELED]: [],
    };
  }

  if (authContext.userId) {
    return {
      [TaskStatus.DRAFT]: [TaskStatus.READY],
      [TaskStatus.READY]: [TaskStatus.DRAFT],
      [TaskStatus.INPUT_REQUIRED]: [],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [],
      [TaskStatus.RUNNING]: [],
      [TaskStatus.COMPLETED]: [],
      [TaskStatus.FAILED]: [],
      [TaskStatus.CANCELED]: [TaskStatus.DRAFT, TaskStatus.READY],
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

export function validateTaskCoworkerAssignment({
  status,
  coworkerId,
}: ValidateTaskCoworkerAssignmentParams): void {
  const hasCoworkerId = coworkerId !== null && coworkerId !== undefined;

  if (status !== TaskStatus.DRAFT && !hasCoworkerId) {
    throw unprocessableEntity(
      "coworkerId is required for non-draft task statuses",
    );
  }
}

export function mapTaskEvent(event: TaskEventWithOptionalTransaction) {
  const { transaction, ...rest } = event;
  return {
    ...rest,
    credits: transaction
      ? Math.abs(convertCentsToCredits(transaction.amount))
      : null,
  };
}

export function mapTask(task: TaskWithIncludes) {
  const jobs = task.jobs.map((job) => flattenJob(job));
  const events = task.events.map((event) => mapTaskEvent(event));
  const credits = events.reduce((total, event) => {
    return total + (event.credits ?? 0);
  }, 0);
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    userId: task.userId,
    organizationId: task.organizationId,
    coworkerId: task.coworkerId,
    name: task.name,
    description: task.description,
    status: task.status,
    events,
    jobs,
    credits,
  };
}
