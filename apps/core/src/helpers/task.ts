import { TaskStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";

import type { AuthenticationContext } from "@/middleware/auth";
import {
  isCoworkerAgentContext,
  isOrchestratorAuthContext,
} from "@/middleware/auth";
import { flattenJob } from "@/types/job";
import {
  type TaskDetailPayload,
  type TaskListItemWithIncludes,
  type TaskWithIncludes,
  taskEventApiInclude,
} from "@/types/task";

import { unprocessableEntity } from "./error";
import {
  coworkerSummaryFromLoadedRelation,
  orchestratorSummaryFromLoadedRelation,
  organizationSummaryFromLoadedRelation,
  userSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";
import { mapTaskLinksForTask } from "./task-link";
import { mapWorkspaceSummary } from "./workspace";

type TaskEventWithOptionalTransaction = Omit<
  TaskWithIncludes["events"][number],
  "transaction"
> & {
  transaction?: {
    amount: bigint;
  } | null;
};

export { taskEventApiInclude };

type TaskEventForMapping = TaskEventWithOptionalTransaction & {
  user?: { id: string; name: string; image: string | null } | null;
  coworker?: {
    id: string;
    name: string;
    image: string | null;
    slug: string;
  } | null;
  orchestratorId?: string | null;
  orchestrator?: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

interface ValidateTaskCoworkerAssignmentParams {
  status: TaskStatus;
  coworkerId: string | null | undefined;
}

function getAllowedTransitions(
  authContext: AuthenticationContext,
): Record<TaskStatus, TaskStatus[]> {
  // Orchestrator may only toggle DRAFT ↔ READY; other status moves are coworker.
  if (isOrchestratorAuthContext(authContext)) {
    return {
      [TaskStatus.DRAFT]: [TaskStatus.READY],
      [TaskStatus.QUEUED]: [],
      [TaskStatus.READY]: [TaskStatus.DRAFT],
      [TaskStatus.GRANT_PENDING]: [],
      [TaskStatus.INPUT_REQUIRED]: [],
      [TaskStatus.APPROVAL_REQUIRED]: [],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [],
      [TaskStatus.OUT_OF_CREDITS]: [],
      [TaskStatus.CREDITS_TOPPED_UP]: [],
      [TaskStatus.RUNNING]: [],
      [TaskStatus.AWAITING_EXTERNAL]: [],
      [TaskStatus.COMPLETED]: [],
      [TaskStatus.FAILED]: [],
      [TaskStatus.CANCELED]: [],
    };
  }

  // A coworker acting as itself (the agent) uses the agent transition table.
  // A delegated coworker acts as the user, so it falls through to the user table.
  if (isCoworkerAgentContext(authContext)) {
    return {
      [TaskStatus.DRAFT]: [],
      [TaskStatus.QUEUED]: [
        TaskStatus.RUNNING,
        TaskStatus.DRAFT,
        TaskStatus.READY,
      ],
      [TaskStatus.READY]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.CANCELED,
        TaskStatus.QUEUED,
      ],
      [TaskStatus.GRANT_PENDING]: [],
      [TaskStatus.INPUT_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.APPROVAL_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      // OUT_OF_CREDITS is system-set when a billed event fails for insufficient
      // balance — coworkers must not set it manually.
      [TaskStatus.OUT_OF_CREDITS]: [
        TaskStatus.CANCELED,
        TaskStatus.FAILED,
        TaskStatus.COMPLETED,
      ],
      [TaskStatus.CREDITS_TOPPED_UP]: [
        TaskStatus.RUNNING,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.RUNNING]: [
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AWAITING_EXTERNAL]: [
        TaskStatus.RUNNING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ],
      // Agents may reopen COMPLETED → RUNNING (SOK-581).
      [TaskStatus.COMPLETED]: [TaskStatus.RUNNING],
      [TaskStatus.FAILED]: [],
      // Agents may reopen CANCELED → RUNNING (SOK-581).
      [TaskStatus.CANCELED]: [TaskStatus.RUNNING],
    };
  }

  return {
    [TaskStatus.DRAFT]: [
      TaskStatus.READY,
      TaskStatus.CANCELED,
      TaskStatus.QUEUED,
    ],
    [TaskStatus.QUEUED]: [TaskStatus.DRAFT, TaskStatus.READY],
    [TaskStatus.READY]: [
      TaskStatus.DRAFT,
      TaskStatus.CANCELED,
      TaskStatus.QUEUED,
    ],
    [TaskStatus.GRANT_PENDING]: [],
    [TaskStatus.INPUT_REQUIRED]: [TaskStatus.CANCELED],
    [TaskStatus.APPROVAL_REQUIRED]: [TaskStatus.CANCELED],
    [TaskStatus.AUTHENTICATION_REQUIRED]: [TaskStatus.CANCELED],
    [TaskStatus.OUT_OF_CREDITS]: [
      TaskStatus.CREDITS_TOPPED_UP,
      TaskStatus.CANCELED,
    ],
    [TaskStatus.CREDITS_TOPPED_UP]: [TaskStatus.CANCELED],
    [TaskStatus.RUNNING]: [TaskStatus.CANCELED],
    [TaskStatus.AWAITING_EXTERNAL]: [TaskStatus.CANCELED],
    // Users may reopen COMPLETED → READY with a required comment (SOK-631).
    [TaskStatus.COMPLETED]: [TaskStatus.READY],
    [TaskStatus.FAILED]: [],
    // Users may reopen CANCELED → READY with a required comment (SOK-631).
    [TaskStatus.CANCELED]: [TaskStatus.READY],
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

export function mapTaskEvent(event: TaskEventForMapping) {
  const { cents, user, coworker, orchestrator, channel, ...rest } = event;

  return {
    ...rest,
    channel,
    origin: channel,
    credits: cents != null ? convertCentsToCredits(cents) : null,
    ...(event.userId != null && user != null
      ? {
          user: {
            id: user.id,
            name: user.name,
            image: user.image,
          },
        }
      : {}),
    ...(event.coworkerId != null && coworker != null
      ? {
          coworker: {
            id: coworker.id,
            name: coworker.name,
            image: coworker.image,
            slug: coworker.slug,
          },
        }
      : {}),
    ...(event.orchestratorId != null && orchestrator != null
      ? {
          orchestrator: {
            id: orchestrator.id,
            name: orchestrator.name,
            slug: orchestrator.slug,
          },
        }
      : {}),
  };
}

function mapTaskSummary(task: TaskListItemWithIncludes | TaskWithIncludes) {
  const taskOrganizationSummary = organizationSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.organizationId,
    task.organization ?? null,
  );

  const taskUserSummary = userSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.userId,
    task.user,
  );

  const taskCoworkerSummary = coworkerSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.coworkerId,
    task.coworker ?? null,
  );

  const taskOrchestratorSummary = orchestratorSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.orchestratorId,
    task.orchestrator ?? null,
  );

  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    userId: task.userId,
    organizationId: task.organizationId,
    projectId: task.projectId,
    user: taskUserSummary,
    organization: taskOrganizationSummary,
    coworkerId: task.coworkerId,
    coworker: taskCoworkerSummary,
    orchestratorId: task.orchestratorId,
    orchestrator: taskOrchestratorSummary,
    name: task.name,
    description: task.description,
    status: task.status,
    // Grant parking fields are intentional API surface while GRANT_PENDING so
    // coworkers and web can correlate the task with the blocking vendor grant.
    grantResumeStatus:
      task.status === TaskStatus.GRANT_PENDING
        ? (task.grantResumeStatus ?? null)
        : null,
    pendingVendorGrantId:
      task.status === TaskStatus.GRANT_PENDING
        ? (task.pendingVendorGrantId ?? null)
        : null,
    metadata: task.metadata ?? null,
    nextRunAt: task.nextRunAt ?? null,
    workspace: mapWorkspaceSummary(task.workspace),
  };
}

function mapTaskBase(task: TaskWithIncludes) {
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

  return {
    ...mapTaskSummary(task),
    events: task.events.map(mapTaskEvent),
    jobs: task.jobs.map(flattenJob),
    credits,
  };
}

export function mapTask(task: TaskWithIncludes | TaskDetailPayload) {
  const links = mapTaskLinksForTask(task.linksFrom, task.linksTo);

  return {
    ...mapTaskBase(task),
    share: task.share,
    links,
  };
}

export function mapTaskListItem(task: TaskListItemWithIncludes) {
  return {
    ...mapTaskSummary(task),
    jobsCount: task._count.jobs,
    commentsCount: task._count.events,
  };
}
