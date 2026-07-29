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

type TaskFileForMapping = TaskWithIncludes["files"][number];

export function mapTaskFile(file: TaskFileForMapping) {
  let uploader: {
    type: "user" | "coworker";
    id: string;
    user?: { id: string; name: string; image: string | null };
    coworker?: {
      id: string;
      name: string;
      image: string | null;
      slug: string;
    };
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
  }

  return {
    id: file.id,
    taskId: file.taskId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    name: file.name,
    fileUrl: file.fileUrl,
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

export function validateTaskAssigneeAssignment({
  status,
  assigneeId,
}: ValidateTaskAssigneeAssignmentParams): void {
  const hasAssigneeId = assigneeId !== null && assigneeId !== undefined;
  const allowsMissingAssignee =
    status === TaskStatus.DRAFT || status === TaskStatus.CANCELED;

  if (!allowsMissingAssignee && !hasAssigneeId) {
    throw unprocessableEntity(
      "assigneeId is required for statuses other than draft or canceled",
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

  const taskAssigneeSummary = coworkerSummaryFromLoadedRelation(
    `Task ${task.id}`,
    task.assigneeId,
    task.assignee ?? null,
  );

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
    assignee: taskAssigneeSummary,
    coworkerId: task.assigneeId,
    coworker: taskAssigneeSummary,
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
