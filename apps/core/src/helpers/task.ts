import { TaskStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import type { AuthenticationContext } from "@/middleware/auth";
import { isCoworkerAuthContext } from "@/middleware/auth";
import { type TaskLinkResponse, taskLinkSchema } from "@/schemas/task.schema";
import { flattenJob } from "@/types/job";
import type {
  TaskLinkPeerTask,
  TaskLinkWithPeerTasks,
  TaskWithIncludes,
} from "@/types/task";

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
  if (isCoworkerAuthContext(authContext)) {
    return {
      [TaskStatus.DRAFT]: [],
      [TaskStatus.READY]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.INPUT_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.OUT_OF_CREDITS]: [
        TaskStatus.CANCELED,
        TaskStatus.FAILED,
        TaskStatus.COMPLETED,
      ],
      [TaskStatus.CREDITS_TOPPED_UP]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.RUNNING]: [
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AWAITING_EXTERNAL]: [
        TaskStatus.RUNNING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.COMPLETED]: [],
      [TaskStatus.FAILED]: [],
      [TaskStatus.CANCEL_REQUESTED]: [
        TaskStatus.CANCELED,
        TaskStatus.OUT_OF_CREDITS,
      ],
      [TaskStatus.CANCELED]: [],
    };
  }

  return {
    [TaskStatus.DRAFT]: [TaskStatus.READY, TaskStatus.CANCELED],
    [TaskStatus.READY]: [TaskStatus.DRAFT, TaskStatus.CANCELED],
    [TaskStatus.INPUT_REQUIRED]: [TaskStatus.CANCEL_REQUESTED],
    [TaskStatus.AUTHENTICATION_REQUIRED]: [TaskStatus.CANCEL_REQUESTED],
    [TaskStatus.OUT_OF_CREDITS]: [
      TaskStatus.CREDITS_TOPPED_UP,
      TaskStatus.CANCEL_REQUESTED,
    ],
    [TaskStatus.CREDITS_TOPPED_UP]: [TaskStatus.CANCEL_REQUESTED],
    [TaskStatus.RUNNING]: [TaskStatus.CANCEL_REQUESTED],
    [TaskStatus.AWAITING_EXTERNAL]: [TaskStatus.CANCEL_REQUESTED],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [],
    [TaskStatus.CANCELED]: [TaskStatus.DRAFT, TaskStatus.READY],
    [TaskStatus.CANCEL_REQUESTED]: [],
  };
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
  const allowsMissingCoworker =
    status === TaskStatus.DRAFT || status === TaskStatus.CANCELED;

  if (!allowsMissingCoworker && !hasCoworkerId) {
    throw unprocessableEntity(
      "coworkerId is required for statuses other than draft or canceled",
    );
  }
}

export function mapTaskEvent(event: TaskEventWithOptionalTransaction) {
  const { cents, ...rest } = event;
  return {
    ...rest,
    credits: cents != null ? convertCentsToCredits(cents) : null,
  };
}

export function isTaskStatusSpendable(status: TaskStatus | undefined): boolean {
  if (status === undefined) {
    return false;
  }

  return status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED;
}

export function isTaskArchivableStatus(status: TaskStatus): boolean {
  return (
    status === TaskStatus.DRAFT ||
    status === TaskStatus.READY ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED
  );
}

function mapTaskLinkPeerTask(peerTask: TaskLinkPeerTask | null) {
  if (!peerTask) {
    return null;
  }

  return {
    id: peerTask.id,
    name: peerTask.name,
    status: peerTask.status,
    archivedAt: peerTask.archivedAt,
  };
}

export function mapTaskLinkForTask(
  taskId: string,
  link: TaskLinkWithPeerTasks,
): TaskLinkResponse {
  const outgoing = link.fromTaskId === taskId;
  const peerTask = outgoing
    ? mapTaskLinkPeerTask(link.toTask ?? null)
    : mapTaskLinkPeerTask(link.fromTask ?? null);
  return taskLinkSchema.parse({
    id: link.id,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    type: link.type,
    note: link.note,
    fromTaskId: link.fromTaskId,
    toTaskId: link.toTaskId,
    direction: outgoing ? "outgoing" : "incoming",
    peerTaskId: outgoing ? link.toTaskId : link.fromTaskId,
    peerTask,
  });
}

export function mapTaskLinksForTask(
  linksFrom: TaskWithIncludes["linksFrom"],
  linksTo: TaskWithIncludes["linksTo"],
): TaskLinkResponse[] {
  return [
    ...linksFrom.map((link) => mapTaskLinkForTask(link.fromTaskId, link)),
    ...linksTo.map((link) => mapTaskLinkForTask(link.toTaskId, link)),
  ];
}

export function mapTask(task: TaskWithIncludes) {
  const jobs = task.jobs.map((job) => flattenJob(job));
  const events = task.events.map((event) => mapTaskEvent(event));
  const credits = task.events.reduce((total, event) => {
    const amount = event.transaction?.amount;
    if (amount === undefined || amount === null) {
      return total;
    }

    if (amount >= 0n) {
      return total;
    }

    return total + convertCentsToCredits(amount * -1n);
  }, 0);
  const links = mapTaskLinksForTask(task.linksFrom, task.linksTo);
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
    links,
  };
}
