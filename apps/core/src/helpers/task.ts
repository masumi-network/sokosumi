import { Channel, Prisma, TaskLinkType, TaskStatus } from "@sokosumi/database";
import { canArchiveTaskStatus, convertCentsToCredits } from "@sokosumi/utils";

import type { AuthenticationContext } from "@/middleware/auth";
import { isAgentAuthContext } from "@/middleware/auth";
import { flattenJob } from "@/types/job";
import {
  type TaskDetailPayload,
  type TaskListItemWithIncludes,
  type TaskWithIncludes,
  taskEventApiInclude,
} from "@/types/task";

import { conflict, unprocessableEntity } from "./error";
import {
  coworkerSummaryFromLoadedRelation,
  orchestratorSummaryFromLoadedRelation,
  organizationSummaryFromLoadedRelation,
  userSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";
import { mapTaskLinksForTask } from "./task-link";
import { mapWorkspaceSummary } from "./workspace";

type TaskFileForMapping = TaskWithIncludes["files"][number];

export function mapTaskFile(file: TaskFileForMapping) {
  let uploader: {
    type: "user" | "coworker" | "orchestrator";
    id: string;
    user?: { id: string; name: string; image: string | null };
    coworker?: {
      id: string;
      name: string;
      image: string | null;
      slug: string;
    };
    orchestrator?: ReturnType<typeof orchestratorSummaryFromLoadedRelation>;
  } | null = null;

  if (file.uploadedByUserId != null) {
    const user = userSummaryFromLoadedRelation(
      `TaskFile ${file.id} uploader`,
      file.uploadedByUserId,
      file.uploadedByUser ?? null,
    );
    uploader = {
      type: "user",
      id: file.uploadedByUserId,
      user,
    };
  } else if (file.uploadedByCoworkerId != null) {
    const coworker = coworkerSummaryFromLoadedRelation(
      `TaskFile ${file.id} uploader`,
      file.uploadedByCoworkerId,
      file.uploadedByCoworker ?? null,
    );
    if (coworker == null) {
      throw new Error(
        `TaskFile ${file.id}: coworker uploader summary missing for API mapping`,
      );
    }
    uploader = {
      type: "coworker",
      id: file.uploadedByCoworkerId,
      coworker,
    };
  } else if (file.uploadedByOrchestratorId != null) {
    const orchestrator = orchestratorSummaryFromLoadedRelation(
      `TaskFile ${file.id} uploader`,
      file.uploadedByOrchestratorId,
      file.uploadedByOrchestrator ?? null,
    );
    if (orchestrator == null) {
      throw new Error(
        `TaskFile ${file.id}: orchestrator uploader summary missing for API mapping`,
      );
    }
    uploader = {
      type: "orchestrator",
      id: file.uploadedByOrchestratorId,
      orchestrator,
    };
  }

  return {
    id: file.id,
    taskId: file.taskId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    name: file.name,
    fileUrl: file.fileUrl,
    sourceUrl: file.sourceUrl,
    status: file.status,
    origin: file.origin,
    mimeType: file.mimeType ?? null,
    size: file.size != null ? Number(file.size) : null,
    uploader,
  };
}

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
    name: string | null;
  } | null;
};

interface ValidateTaskAssigneeAssignmentParams {
  status: TaskStatus;
  assigneeId: string | null | undefined;
  assigneeOrchestratorId?: string | null | undefined;
  assigneeUserId?: string | null | undefined;
}

export type TaskAssigneeKind = "coworker" | "orchestrator" | "human" | "unset";

const AGENT_ONLY_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.QUEUED,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.FAILED,
]);

function hasAssigneeValue(value: string | null | undefined): boolean {
  return value != null && value !== "";
}

export function taskAssigneeKind(task: {
  assigneeId: string | null | undefined;
  assigneeOrchestratorId?: string | null | undefined;
  assigneeUserId?: string | null | undefined;
}): TaskAssigneeKind {
  if (hasAssigneeValue(task.assigneeId)) {
    return "coworker";
  }
  if (hasAssigneeValue(task.assigneeOrchestratorId)) {
    return "orchestrator";
  }
  if (hasAssigneeValue(task.assigneeUserId)) {
    return "human";
  }
  return "unset";
}

function getAllowedTransitions(
  authContext: AuthenticationContext,
  assigneeKind: TaskAssigneeKind = "coworker",
): Record<TaskStatus, TaskStatus[]> {
  // A coworker acting as itself (the agent) uses the agent transition table.
  // A delegated coworker acts as the user, so it falls through to the user table.
  if (isAgentAuthContext(authContext)) {
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

  if (assigneeKind === "human" || assigneeKind === "unset") {
    return {
      [TaskStatus.DRAFT]: [TaskStatus.READY, TaskStatus.CANCELED],
      [TaskStatus.QUEUED]: [],
      [TaskStatus.READY]: [
        TaskStatus.DRAFT,
        TaskStatus.CANCELED,
        TaskStatus.RUNNING,
      ],
      [TaskStatus.GRANT_PENDING]: [],
      [TaskStatus.INPUT_REQUIRED]: [TaskStatus.CANCELED],
      [TaskStatus.APPROVAL_REQUIRED]: [TaskStatus.CANCELED],
      [TaskStatus.AUTHENTICATION_REQUIRED]: [TaskStatus.CANCELED],
      [TaskStatus.OUT_OF_CREDITS]: [TaskStatus.CANCELED],
      [TaskStatus.CREDITS_TOPPED_UP]: [TaskStatus.CANCELED],
      [TaskStatus.RUNNING]: [
        TaskStatus.READY,
        TaskStatus.AWAITING_EXTERNAL,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.AWAITING_EXTERNAL]: [
        TaskStatus.RUNNING,
        TaskStatus.READY,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELED,
      ],
      [TaskStatus.COMPLETED]: [TaskStatus.READY],
      [TaskStatus.FAILED]: [],
      [TaskStatus.CANCELED]: [TaskStatus.READY],
    };
  }

  return {
    [TaskStatus.DRAFT]: [
      TaskStatus.READY,
      TaskStatus.CANCELED,
      TaskStatus.QUEUED,
    ],
    [TaskStatus.QUEUED]: [
      TaskStatus.DRAFT,
      TaskStatus.READY,
      TaskStatus.CANCELED,
    ],
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

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
]);

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function getTaskStatusUpdateDataForEvent(status: TaskStatus): {
  status: TaskStatus;
  metadata?: null;
  nextRunAt?: null;
} {
  if (status === TaskStatus.CANCELED) {
    return {
      status,
      metadata: null,
      nextRunAt: null,
    };
  }

  return { status };
}

interface TaskEventActorData {
  userId: string | null;
  coworkerId: string | null;
  orchestratorId: string | null;
}

interface CascadeCancelScheduleRunsParams {
  tx: Prisma.TransactionClient;
  parentTaskId: string;
  actorData: TaskEventActorData;
}

export interface CascadedCancelChild {
  taskId: string;
  userId: string;
}

/**
 * Cascade-cancel non-terminal schedule runs linked from a template via
 * {@link TaskLinkType.SCHEDULE} (from = template, to = run). Manual PARENT
 * hierarchy is not cascaded.
 */
export async function cascadeCancelNonTerminalScheduleRuns({
  tx,
  parentTaskId,
  actorData,
}: CascadeCancelScheduleRunsParams): Promise<CascadedCancelChild[]> {
  const scheduleLinks = await tx.taskLink.findMany({
    where: {
      fromTaskId: parentTaskId,
      type: TaskLinkType.SCHEDULE,
    },
    select: {
      toTask: {
        select: {
          id: true,
          status: true,
          ownerId: true,
        },
      },
    },
  });

  const canceledChildren: CascadedCancelChild[] = [];

  for (const link of scheduleLinks) {
    const child = link.toTask;
    if (isTerminalTaskStatus(child.status)) {
      continue;
    }

    await tx.taskEvent.create({
      data: {
        taskId: child.id,
        status: TaskStatus.CANCELED,
        channel: Channel.SOKOSUMI,
        ...actorData,
      },
    });

    const childUpdate = await tx.task.updateMany({
      where: { id: child.id, status: child.status },
      data: getTaskStatusUpdateDataForEvent(TaskStatus.CANCELED),
    });
    if (childUpdate.count !== 1) {
      throw conflict("Task status was changed by another request");
    }

    canceledChildren.push({
      taskId: child.id,
      userId: child.ownerId,
    });
  }

  return canceledChildren;
}

interface CascadeArchiveScheduleParentChildrenParams {
  tx: Prisma.TransactionClient;
  parentTaskId: string;
  archivedAt: Date;
}

/**
 * Soft-archive schedule runs linked from a template via
 * {@link TaskLinkType.SCHEDULE}. Blocks when any non-archived run is not
 * archivable (e.g. RUNNING) so the series is never half-hidden. Manual PARENT
 * hierarchy is not cascaded.
 */
export async function cascadeArchiveScheduleParentChildren({
  tx,
  parentTaskId,
  archivedAt,
}: CascadeArchiveScheduleParentChildrenParams): Promise<string[]> {
  const scheduleLinks = await tx.taskLink.findMany({
    where: {
      fromTaskId: parentTaskId,
      type: TaskLinkType.SCHEDULE,
    },
    select: {
      toTask: {
        select: {
          id: true,
          status: true,
          archivedAt: true,
        },
      },
    },
  });

  const activeRuns = scheduleLinks
    .map((link) => link.toTask)
    .filter((child) => child.archivedAt == null);

  const blockingRun = activeRuns.find(
    (child) => !canArchiveTaskStatus(child.status),
  );
  if (blockingRun) {
    throw unprocessableEntity(
      `Cannot archive schedule template while a schedule run is still in progress (status: ${blockingRun.status}). Wait for in-progress runs to finish, or cancel them first.`,
    );
  }

  const archivedChildIds: string[] = [];

  for (const child of activeRuns) {
    const childUpdate = await tx.task.updateMany({
      where: { id: child.id, archivedAt: null, status: child.status },
      data: { archivedAt },
    });
    if (childUpdate.count !== 1) {
      throw conflict("Task was modified concurrently; retry archive");
    }

    archivedChildIds.push(child.id);
  }

  return archivedChildIds;
}

export function validateStatusTransition(
  authContext: AuthenticationContext,
  from: TaskStatus,
  to: TaskStatus,
  assigneeKind: TaskAssigneeKind = "coworker",
): void {
  if (from === to) {
    throw unprocessableEntity("Invalid status transition: same status");
  }

  const allowedTransitions = getAllowedTransitions(authContext, assigneeKind);
  if (!allowedTransitions[from].includes(to)) {
    throw unprocessableEntity(
      `Invalid status transition from ${from} to ${to}`,
    );
  }
}

export function validateTaskAssigneeAssignment({
  status,
  assigneeId,
  assigneeOrchestratorId,
  assigneeUserId,
}: ValidateTaskAssigneeAssignmentParams): void {
  const hasCoworker = hasAssigneeValue(assigneeId);
  const hasOrchestrator = hasAssigneeValue(assigneeOrchestratorId);
  const hasUser = hasAssigneeValue(assigneeUserId);

  const setCount =
    (hasCoworker ? 1 : 0) + (hasOrchestrator ? 1 : 0) + (hasUser ? 1 : 0);
  if (setCount > 1) {
    throw unprocessableEntity(
      "Task cannot be assigned to more than one assignee",
    );
  }

  if (
    AGENT_ONLY_TASK_STATUSES.has(status) &&
    !hasCoworker &&
    !hasOrchestrator
  ) {
    throw unprocessableEntity(
      "An agent (Coworker or orchestrator) assignee is required for this status",
    );
  }
}

export function mapTaskEventActor(event: TaskEventForMapping) {
  if (
    event.userId == null &&
    event.coworkerId == null &&
    event.orchestratorId == null
  ) {
    return null;
  }

  // Prefer the acting agent when legacy rows stored multiple FKs
  // (orchestrator/coworker status events used to also set context userId).
  // New writes set exactly one actor FK.
  // Prefer order: orchestrator → coworker → user.
  if (event.orchestratorId != null) {
    const orchestrator = orchestratorSummaryFromLoadedRelation(
      `Task event ${event.id} actor`,
      event.orchestratorId,
      event.orchestrator ?? null,
    );
    if (orchestrator == null) {
      throw new Error(
        `Task event ${event.id}: actor orchestrator summary missing for API mapping`,
      );
    }

    return {
      type: "orchestrator" as const,
      id: event.orchestratorId,
      orchestrator,
    };
  }

  if (event.coworkerId != null) {
    const coworker = coworkerSummaryFromLoadedRelation(
      `Task event ${event.id} actor`,
      event.coworkerId,
      event.coworker ?? null,
    );
    if (coworker == null) {
      throw new Error(
        `Task event ${event.id}: actor coworker summary missing for API mapping`,
      );
    }

    return {
      type: "coworker" as const,
      id: event.coworkerId,
      coworker,
    };
  }

  const userId = event.userId;
  if (userId == null) {
    // Unreachable: early return covers zero FKs; orch/coworker already handled.
    throw new Error(
      `Task event ${event.id}: unable to resolve actor for API mapping`,
    );
  }

  return {
    type: "user" as const,
    id: userId,
    user: userSummaryFromLoadedRelation(
      `Task event ${event.id} actor`,
      userId,
      event.user ?? null,
    ),
  };
}

export function mapTaskEvent(event: TaskEventForMapping) {
  const {
    cents,
    channel,
    user: _user,
    coworker: _coworker,
    orchestrator: _orchestrator,
    ...rest
  } = event;
  const actor = mapTaskEventActor(event);

  return {
    ...rest,
    channel,
    origin: channel,
    credits: cents != null ? convertCentsToCredits(cents) : null,
    actor,
    ...(actor?.type === "user"
      ? {
          user: actor.user,
        }
      : {}),
    ...(actor?.type === "coworker"
      ? {
          coworker: actor.coworker,
        }
      : {}),
    ...(actor?.type === "orchestrator"
      ? {
          orchestrator: actor.orchestrator,
        }
      : {}),
  };
}

function mapTaskCreator(task: TaskListItemWithIncludes | TaskWithIncludes) {
  if (task.creatorUserId != null) {
    return {
      type: "user" as const,
      id: task.creatorUserId,
      user: userSummaryFromLoadedRelation(
        `Task ${task.id} creator`,
        task.creatorUserId,
        task.creatorUser ?? null,
      ),
    };
  }

  if (task.creatorCoworkerId != null) {
    const coworker = coworkerSummaryFromLoadedRelation(
      `Task ${task.id} creator`,
      task.creatorCoworkerId,
      task.creatorCoworker ?? null,
    );
    if (coworker == null) {
      throw new Error(
        `Task ${task.id}: creator coworker summary missing for API mapping`,
      );
    }

    return {
      type: "coworker" as const,
      id: task.creatorCoworkerId,
      coworker,
    };
  }

  if (task.creatorOrchestratorId != null) {
    const orchestrator = orchestratorSummaryFromLoadedRelation(
      `Task ${task.id} creator`,
      task.creatorOrchestratorId,
      task.creatorOrchestrator ?? null,
    );
    if (orchestrator == null) {
      throw new Error(
        `Task ${task.id}: creator orchestrator summary missing for API mapping`,
      );
    }

    return {
      type: "orchestrator" as const,
      id: task.creatorOrchestratorId,
      orchestrator,
    };
  }

  throw new Error(
    `Task ${task.id}: exactly one creator FK must be set for API mapping`,
  );
}

function mapTaskAssignee(task: TaskListItemWithIncludes | TaskWithIncludes) {
  if (task.assigneeId != null) {
    const coworker = coworkerSummaryFromLoadedRelation(
      `Task ${task.id}`,
      task.assigneeId,
      task.assignee ?? null,
    );
    if (coworker == null) {
      throw new Error(
        `Task ${task.id}: assignee coworker summary missing for API mapping`,
      );
    }

    return {
      type: "coworker" as const,
      id: task.assigneeId,
      coworker,
    };
  }

  if (task.assigneeOrchestratorId != null) {
    const orchestrator = orchestratorSummaryFromLoadedRelation(
      `Task ${task.id}`,
      task.assigneeOrchestratorId,
      task.assigneeOrchestrator ?? null,
    );
    if (orchestrator == null) {
      throw new Error(
        `Task ${task.id}: assignee orchestrator summary missing for API mapping`,
      );
    }

    return {
      type: "orchestrator" as const,
      id: task.assigneeOrchestratorId,
      orchestrator,
    };
  }

  if (task.assigneeUserId != null) {
    return {
      type: "user" as const,
      id: task.assigneeUserId,
      user: userSummaryFromLoadedRelation(
        `Task ${task.id} assignee`,
        task.assigneeUserId,
        task.assigneeUser ?? null,
      ),
    };
  }

  return null;
}

function mapTaskSummary(task: TaskListItemWithIncludes | TaskWithIncludes) {
  const taskOrganizationSummary = organizationSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.organizationId,
    task.organization ?? null,
  );

  const taskOwnerSummary = userSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.ownerId,
    task.owner,
  );

  const assignee = mapTaskAssignee(task);
  const creator = mapTaskCreator(task);

  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ownerId: task.ownerId,
    owner: taskOwnerSummary,
    // Deprecated aliases — keep until clients migrate.
    userId: task.ownerId,
    user: taskOwnerSummary,
    organizationId: task.organizationId,
    projectId: task.projectId,
    organization: taskOrganizationSummary,
    assigneeId: task.assigneeId,
    assigneeOrchestratorId: task.assigneeOrchestratorId ?? null,
    assigneeUserId: task.assigneeUserId ?? null,
    assignee,
    coworkerId: task.assigneeId,
    coworker: assignee?.type === "coworker" ? assignee.coworker : null,
    creator,
    // Deprecated aliases for legacy orchestrator-created tasks.
    orchestratorId: creator.type === "orchestrator" ? creator.id : null,
    orchestrator: creator.type === "orchestrator" ? creator.orchestrator : null,
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
    scheduleRevision: task.scheduleRevision ?? 0,
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
  const files = "files" in task && Array.isArray(task.files) ? task.files : [];

  return {
    ...mapTaskBase(task),
    share: task.share,
    links,
    files: files.map(mapTaskFile),
  };
}

export function mapTaskListItem(task: TaskListItemWithIncludes) {
  return {
    ...mapTaskSummary(task),
    jobsCount: task._count.jobs,
    commentsCount: task._count.events,
  };
}
