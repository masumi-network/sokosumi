import {
  Channel,
  type GrantResumeStatus,
  type Prisma,
  type Task,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { isTaskEditableStatus } from "@sokosumi/utils";

import {
  requireTaskAssignableCoworker,
  requireTaskAssignableSokoBot,
  requireTaskAssignableUser,
  type TaskAssigner,
} from "@/helpers/access-control";
import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import { nextAssigneeWrite } from "@/helpers/task-assignee-alias";
import {
  isGrantDeniedOrRevoked,
  parseGrantResumeStatus,
  requestWorkspaceGrant,
  requireTaskNotParked,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";

export type TaskDomainActor =
  | { kind: "user"; userId: string }
  | {
      kind: "coworker";
      coworkerId: string;
      vendorId: string;
      enforceWorkspaceGrant: boolean;
    }
  | { kind: "soko_bot"; sokoBotId: string };

export interface CreateTaskDomainInput {
  actor: TaskDomainActor;
  ownerId: string;
  organizationId: string | null;
  workspaceId: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  resolveDescription?: (tx: Prisma.TransactionClient) => Promise<string | null>;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  status: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
  channel?: Channel;
}

export interface UpdateTaskDomainInput {
  actor: TaskDomainActor;
  ownerId: string;
  /** Required for Soko Bot. User routes retain owner-scoped PATCH semantics. */
  workspaceId?: string;
  taskId: string;
  intent: "metadata" | "assignment";
  name?: string;
  description?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  status?: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
  channel?: Channel;
}

interface PendingGrantState {
  pendingVendorGrantId: string;
  grantResumeStatus: GrantResumeStatus;
}

function hasAssigneeValue(value: string | null | undefined): boolean {
  return value != null && value !== "";
}

// Agent-only statuses (queue, grants, HITL, credits, failed) require a
// coworker or sokoBot assignee. Kept local so this domain seam does not
// import `@/helpers/task`, which pulls HTTP middleware at module load.
// Mirrors `AGENT_ONLY_TASK_STATUSES` in `@/helpers/task`.
const AGENT_ONLY_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.QUEUED,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.FAILED,
]);

function requireAssigneeXor(
  assigneeId: string | null | undefined,
  assigneeSokoBotId: string | null | undefined,
  assigneeUserId?: string | null | undefined,
): void {
  const setCount =
    (hasAssigneeValue(assigneeId) ? 1 : 0) +
    (hasAssigneeValue(assigneeSokoBotId) ? 1 : 0) +
    (hasAssigneeValue(assigneeUserId) ? 1 : 0);
  if (setCount > 1) {
    throw unprocessableEntity(
      "Task cannot be assigned to more than one assignee",
    );
  }
}

function requireAssigneeForExecutableStatus(
  status: TaskStatus,
  assigneeId: string | null | undefined,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null | undefined,
): void {
  requireAssigneeXor(assigneeId, assigneeSokoBotId, assigneeUserId);
  if (
    AGENT_ONLY_STATUSES.has(status) &&
    !hasAssigneeValue(assigneeId) &&
    !hasAssigneeValue(assigneeSokoBotId)
  ) {
    throw unprocessableEntity(
      "An agent (Coworker or Soko Bot) assignee is required for this status",
    );
  }
}

const SOKO_BOT_UPDATE_STATUSES = [TaskStatus.DRAFT, TaskStatus.READY] as const;
const SOKO_BOT_ASSIGN_STATUSES = SOKO_BOT_UPDATE_STATUSES;

async function requireProjectInWorkspace(
  projectId: string | null | undefined,
  workspaceId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (projectId === null || projectId === undefined) return;

  const project = await tx.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) throw notFound("Project not found");
}

/** Only a user or a Soko Bot acting for itself carries tasking authority. */
function taskAssigner(actor: TaskDomainActor): TaskAssigner {
  switch (actor.kind) {
    case "user":
      return { kind: "user", userId: actor.userId };
    case "soko_bot":
      return { kind: "soko_bot", sokoBotId: actor.sokoBotId };
    case "coworker":
      return { kind: "other" };
  }
}

async function requireTaskReferences(
  input: {
    projectId?: string | null;
    assigneeId?: string | null;
    assigneeSokoBotId?: string | null;
    assigneeUserId?: string | null;
    workspaceId: string;
    actor: TaskDomainActor;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  await requireProjectInWorkspace(input.projectId, input.workspaceId, tx);
  if (input.assigneeId !== null && input.assigneeId !== undefined) {
    await requireTaskAssignableCoworker(
      input.assigneeId,
      input.workspaceId,
      tx,
      taskAssigner(input.actor),
    );
  }
  if (
    input.assigneeSokoBotId !== null &&
    input.assigneeSokoBotId !== undefined
  ) {
    await requireTaskAssignableSokoBot(
      input.assigneeSokoBotId,
      input.workspaceId,
      tx,
      taskAssigner(input.actor),
    );
  }
  if (input.assigneeUserId !== null && input.assigneeUserId !== undefined) {
    await requireTaskAssignableUser(
      input.assigneeUserId,
      input.workspaceId,
      tx,
    );
  }
}

function creatorFields(actor: TaskDomainActor) {
  switch (actor.kind) {
    case "user":
      return {
        creatorUserId: actor.userId,
        creatorCoworkerId: null,
        creatorSokoBotId: null,
      };
    case "coworker":
      return {
        creatorUserId: null,
        creatorCoworkerId: actor.coworkerId,
        creatorSokoBotId: null,
      };
    case "soko_bot":
      return {
        creatorUserId: null,
        creatorCoworkerId: null,
        creatorSokoBotId: actor.sokoBotId,
      };
  }
}

function eventActorFields(actor: TaskDomainActor) {
  switch (actor.kind) {
    case "user":
      return {
        userId: actor.userId,
        coworkerId: null,
        sokoBotId: null,
      };
    case "coworker":
      return {
        userId: null,
        coworkerId: actor.coworkerId,
        sokoBotId: null,
      };
    case "soko_bot":
      return {
        userId: null,
        coworkerId: null,
        sokoBotId: actor.sokoBotId,
      };
  }
}

async function resolvePendingGrant(
  input: CreateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<PendingGrantState | null> {
  if (input.actor.kind !== "coworker" || !input.actor.enforceWorkspaceGrant) {
    return null;
  }

  const { grant } = await requestWorkspaceGrant(
    {
      vendorId: input.actor.vendorId,
      workspaceId: input.workspaceId,
      requestedByUserId: input.ownerId,
      notify: false,
    },
    tx,
  );
  if (isGrantDeniedOrRevoked(grant.status)) {
    throwGrantAccessError(grant.status);
  }
  if (grant.status === VendorGrantStatus.GRANTED) return null;

  return {
    pendingVendorGrantId: grant.id,
    grantResumeStatus: parseGrantResumeStatus(input.status),
  };
}

/**
 * Canonical Task creation operation. Authentication and workspace ownership
 * happen before this seam; Task invariants and durable side effects live here.
 */
export async function createTaskForActor(
  input: CreateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  requireAssigneeXor(
    input.assigneeId,
    input.assigneeSokoBotId,
    input.assigneeUserId,
  );
  await requireTaskReferences(input, tx);
  const pendingGrant = await resolvePendingGrant(input, tx);
  const status = pendingGrant ? TaskStatus.GRANT_PENDING : input.status;
  // GRANT_PENDING is agent-only. A delegated create that parks for a vendor
  // grant and omitted assigneeId still belongs to the acting coworker.
  const hasUserAssignee =
    input.assigneeUserId != null && input.assigneeUserId !== "";
  const hasAgentAssignee =
    (input.assigneeId != null && input.assigneeId !== "") ||
    (input.assigneeSokoBotId != null && input.assigneeSokoBotId !== "");
  const assigneeId =
    pendingGrant &&
    input.actor.kind === "coworker" &&
    !hasAgentAssignee &&
    !hasUserAssignee
      ? input.actor.coworkerId
      : input.assigneeId;
  requireAssigneeForExecutableStatus(
    status,
    assigneeId,
    input.assigneeSokoBotId,
    input.assigneeUserId,
  );
  const description =
    pendingGrant || !input.resolveDescription
      ? (input.description ?? null)
      : await input.resolveDescription(tx);

  return tx.task.create({
    data: {
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name,
      description,
      assigneeId: assigneeId ?? null,
      assigneeSokoBotId: input.assigneeSokoBotId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      ...creatorFields(input.actor),
      status,
      grantResumeStatus: pendingGrant?.grantResumeStatus ?? null,
      pendingVendorGrantId: pendingGrant?.pendingVendorGrantId ?? null,
      metadata: null,
      nextRunAt: null,
      events: {
        create: {
          status,
          comment: null,
          channel: input.channel ?? Channel.SOKOSUMI,
          ...eventActorFields(input.actor),
        },
      },
    },
  });
}

function sokoBotEditableStatuses(
  intent: UpdateTaskDomainInput["intent"],
): readonly TaskStatus[] {
  return intent === "assignment"
    ? SOKO_BOT_ASSIGN_STATUSES
    : SOKO_BOT_UPDATE_STATUSES;
}

async function requireMutableTask(
  input: UpdateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  if (input.actor.kind === "coworker") {
    throw forbidden("Coworkers cannot update task metadata");
  }
  if (input.actor.kind === "soko_bot" && !input.workspaceId) {
    throw new Error("Soko Bot task mutation requires workspaceId");
  }

  const allowedSokoBotStatuses =
    input.actor.kind === "soko_bot"
      ? sokoBotEditableStatuses(input.intent)
      : null;
  // The status ceiling is checked after the lookup, not folded into it. Doing
  // both at once reported a Task in the wrong state as one that does not
  // exist: a bot that had just read the Task with `get_task_status` was told
  // by `assign_task` that the same id was not found, so it created a
  // duplicate rather than saying what was actually wrong.
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      ownerId: input.ownerId,
      archivedAt: null,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
  });
  if (!task) throw notFound("Task not found");
  if (allowedSokoBotStatuses && !allowedSokoBotStatuses.includes(task.status)) {
    throw forbidden(
      `This Task is ${task.status}. ${
        input.intent === "assignment" ? "Assigning" : "Updating"
      } is possible while it is ${[...allowedSokoBotStatuses].join(" or ")}.`,
    );
  }

  requireTaskNotParked(task);
  if (input.actor.kind === "user" && !isTaskEditableStatus(task.status)) {
    throw forbidden("You can only update draft, queued, or ready tasks");
  }
  return task;
}

/**
 * Canonical metadata/assignment operation. Soko Bot stays inside its bounded
 * pre-execution state ceiling; owner route keeps existing editable-state rules.
 */
export async function updateTaskForActor(
  input: UpdateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  const task = await requireMutableTask(input, tx);
  if (input.status !== undefined && input.actor.kind !== "soko_bot") {
    throw unprocessableEntity(
      "Task status changes must use the task event operation",
    );
  }

  requireAssigneeXor(
    input.assigneeId,
    input.assigneeSokoBotId,
    input.assigneeUserId,
  );
  const assigneeWrite = nextAssigneeWrite({
    assigneeId: input.assigneeId,
    assigneeSokoBotId: input.assigneeSokoBotId,
    assigneeUserId: input.assigneeUserId,
  });
  const nextAssigneeId = assigneeWrite
    ? assigneeWrite.assigneeId
    : task.assigneeId;
  const nextAssigneeSokoBotId = assigneeWrite
    ? assigneeWrite.assigneeSokoBotId
    : task.assigneeSokoBotId;
  const nextAssigneeUserId = assigneeWrite
    ? assigneeWrite.assigneeUserId
    : task.assigneeUserId;
  const nextStatus = input.status ?? task.status;
  requireAssigneeForExecutableStatus(
    nextStatus,
    nextAssigneeId,
    nextAssigneeSokoBotId,
    nextAssigneeUserId,
  );

  await requireTaskReferences(
    {
      workspaceId: task.workspaceId,
      projectId: input.projectId,
      assigneeId: assigneeWrite ? assigneeWrite.assigneeId : undefined,
      assigneeSokoBotId: assigneeWrite
        ? assigneeWrite.assigneeSokoBotId
        : undefined,
      assigneeUserId: assigneeWrite ? assigneeWrite.assigneeUserId : undefined,
      actor: input.actor,
    },
    tx,
  );

  const allowedStatuses =
    input.actor.kind === "soko_bot"
      ? sokoBotEditableStatuses(input.intent)
      : [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY];
  return tx.task.update({
    where: {
      id: task.id,
      ownerId: input.ownerId,
      archivedAt: null,
      status: { in: [...allowedStatuses] },
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
    data: {
      name: input.name,
      description: input.description,
      projectId: input.projectId,
      ...(assigneeWrite ?? {}),
      status: input.status,
      // Record a status event only for a real transition; a Soko Bot
      // re-assignment that keeps DRAFT must not spam the task timeline.
      events:
        input.status !== undefined && input.status !== task.status
          ? {
              create: {
                status: input.status,
                channel: input.channel ?? Channel.SOKOSUMI,
                ...eventActorFields(input.actor),
              },
            }
          : undefined,
    },
  });
}
