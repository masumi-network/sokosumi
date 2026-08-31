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
  requireTaskAssignableUser,
  type TaskAssigner,
} from "@/helpers/access-control";
import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import { validateTaskAssigneeAssignment } from "@/helpers/task";
import { resolveNextTaskAssignees } from "@/helpers/task-assignee-alias";
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
  assigneeUserId?: string | null;
  status?: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
  channel?: Channel;
}

interface PendingGrantState {
  pendingVendorGrantId: string;
  grantResumeStatus: GrantResumeStatus;
}

function requireAssigneeForStatus(
  status: TaskStatus,
  assigneeId: string | null | undefined,
  assigneeUserId: string | null | undefined,
): void {
  validateTaskAssigneeAssignment({
    status,
    assigneeId,
    assigneeUserId,
  });
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
        creatorOrchestratorId: null,
      };
    case "coworker":
      return {
        creatorUserId: null,
        creatorCoworkerId: actor.coworkerId,
        creatorOrchestratorId: null,
      };
    case "soko_bot":
      return {
        creatorUserId: null,
        creatorCoworkerId: null,
        creatorOrchestratorId: actor.sokoBotId,
      };
  }
}

function eventActorFields(actor: TaskDomainActor) {
  switch (actor.kind) {
    case "user":
      return {
        userId: actor.userId,
        coworkerId: null,
        orchestratorId: null,
      };
    case "coworker":
      return {
        userId: null,
        coworkerId: actor.coworkerId,
        orchestratorId: null,
      };
    case "soko_bot":
      return {
        userId: null,
        coworkerId: null,
        orchestratorId: actor.sokoBotId,
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
  requireAssigneeForStatus(
    input.status,
    input.assigneeId,
    input.assigneeUserId,
  );
  await requireTaskReferences(input, tx);
  const pendingGrant = await resolvePendingGrant(input, tx);
  const status = pendingGrant ? TaskStatus.GRANT_PENDING : input.status;
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
      assigneeId: input.assigneeId ?? null,
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

function sokoBotEditableStatuses(intent: UpdateTaskDomainInput["intent"]) {
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
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      ownerId: input.ownerId,
      archivedAt: null,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(allowedSokoBotStatuses
        ? { status: { in: [...allowedSokoBotStatuses] } }
        : {}),
    },
  });
  if (!task) throw notFound("Task not found");

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

  const nextAssignees = resolveNextTaskAssignees(
    {
      assigneeId: input.assigneeId,
      assigneeUserId: input.assigneeUserId,
    },
    {
      assigneeId: task.assigneeId,
      assigneeUserId: task.assigneeUserId,
    },
  );
  const nextStatus = input.status ?? task.status;
  requireAssigneeForStatus(
    nextStatus,
    nextAssignees.assigneeId,
    nextAssignees.assigneeUserId,
  );

  const assigneeWasProvided =
    input.assigneeId !== undefined || input.assigneeUserId !== undefined;
  await requireTaskReferences(
    {
      workspaceId: task.workspaceId,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      assigneeUserId: input.assigneeUserId,
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
      ...(assigneeWasProvided
        ? {
            assigneeId: nextAssignees.assigneeId,
            assigneeUserId: nextAssignees.assigneeUserId,
          }
        : {}),
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
