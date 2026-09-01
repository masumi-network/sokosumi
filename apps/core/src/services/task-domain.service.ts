import {
  Channel,
  type GrantResumeStatus,
  type Prisma,
  type Task,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { isTaskEditableStatus } from "@sokosumi/utils";
import { type TaskAssigner } from "@/helpers/access-control";
import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import {
  hasResolvedTaskAssignee,
  type ResolvedTaskAssignee,
  type TaskAssigneeRequestFields,
} from "@/helpers/task-assignee";
import { resolveTaskAssigneeForWrite } from "@/helpers/task-assignee-resolution";
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
  assigneeOrchestratorId?: string | null;
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
  assigneeOrchestratorId?: string | null;
  status?: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
  channel?: Channel;
}

interface PendingGrantState {
  pendingVendorGrantId: string;
  grantResumeStatus: GrantResumeStatus;
}

function requireAssigneeForExecutableStatus(
  status: TaskStatus,
  assignee: ResolvedTaskAssignee,
): void {
  const allowsMissingAssignee =
    status === TaskStatus.DRAFT || status === TaskStatus.CANCELED;
  if (!allowsMissingAssignee && !hasResolvedTaskAssignee(assignee)) {
    throw unprocessableEntity(
      "An assignee is required for statuses other than draft or canceled",
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
    assignee?: TaskAssigneeRequestFields;
    workspaceId: string;
    actor: TaskDomainActor;
  },
  tx: Prisma.TransactionClient,
): Promise<ResolvedTaskAssignee | null> {
  await requireProjectInWorkspace(input.projectId, input.workspaceId, tx);
  if (!input.assignee) return null;
  const hasAssigneeField =
    input.assignee.assigneeId !== undefined ||
    input.assignee.assigneeOrchestratorId !== undefined;
  if (!hasAssigneeField) return null;
  return resolveTaskAssigneeForWrite(
    input.assignee,
    {
      workspaceId: input.workspaceId,
      assigner: taskAssigner(input.actor),
    },
    tx,
  );
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
  const assignee = await requireTaskReferences(
    {
      projectId: input.projectId,
      assignee: {
        assigneeId: input.assigneeId,
        assigneeOrchestratorId: input.assigneeOrchestratorId,
      },
      workspaceId: input.workspaceId,
      actor: input.actor,
    },
    tx,
  );
  const resolvedAssignee: ResolvedTaskAssignee = assignee ?? {
    assigneeId: input.assigneeId ?? null,
    assigneeOrchestratorId: input.assigneeOrchestratorId ?? null,
  };
  requireAssigneeForExecutableStatus(input.status, resolvedAssignee);
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
      assigneeId: resolvedAssignee.assigneeId,
      assigneeOrchestratorId: resolvedAssignee.assigneeOrchestratorId,
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

  const assigneeFieldsProvided =
    input.assigneeId !== undefined ||
    input.assigneeOrchestratorId !== undefined;
  const existingAssignee: ResolvedTaskAssignee = {
    assigneeId: task.assigneeId,
    assigneeOrchestratorId: task.assigneeOrchestratorId,
  };
  let nextAssignee = existingAssignee;
  if (assigneeFieldsProvided) {
    const resolved = await requireTaskReferences(
      {
        workspaceId: task.workspaceId,
        projectId: input.projectId,
        assignee: {
          assigneeId: input.assigneeId,
          assigneeOrchestratorId: input.assigneeOrchestratorId,
        },
        actor: input.actor,
      },
      tx,
    );
    if (resolved) {
      nextAssignee = resolved;
    }
  }
  const nextStatus = input.status ?? task.status;
  requireAssigneeForExecutableStatus(nextStatus, nextAssignee);

  if (input.projectId !== undefined) {
    await requireProjectInWorkspace(input.projectId, task.workspaceId, tx);
  }

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
      ...(assigneeFieldsProvided
        ? {
            assigneeId: nextAssignee.assigneeId,
            assigneeOrchestratorId: nextAssignee.assigneeOrchestratorId,
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
