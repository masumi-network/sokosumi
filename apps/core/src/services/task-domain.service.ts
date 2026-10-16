import {
  Channel,
  type GrantResumeStatus,
  type Prisma,
  type Task,
  type TaskPriority,
  TaskStatus,
  TaskVisibility,
  VendorGrantStatus,
} from "@sokosumi/database";
import {
  canArchiveTaskStatus,
  countSetAssignees,
  getTaskCannotArchiveMessage,
  hasAssigneeValue,
  isAgentOnlyTaskStatus,
  isTaskEditableStatus,
} from "@sokosumi/utils";
import {
  requireTaskAssignableCoworker,
  requireTaskAssignableSokoBot,
  requireTaskAssignableUser,
  requireTaskWriteAccess,
  type TaskAssigner,
} from "@/helpers/access-control";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import type { AssignedTask } from "@/helpers/soko-bot-task-assign";
import { nextAssigneeWrite } from "@/helpers/task-assignee-alias";
import { taskCreationEvents } from "@/helpers/task-creation-events";
import {
  buildSokoBotScopeTaskWhere,
  sokoBotSharedScopeOf,
} from "@/helpers/task-visibility";
import {
  isGrantDeniedOrRevoked,
  parseGrantResumeStatus,
  requestWorkspaceGrant,
  requireTaskNotParked,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";
import { creatorFields } from "@/helpers/work-creator";

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
  /** Null only for a shared Soko Bot acting on its own (ADR 0057). */
  ownerId: string | null;
  organizationId: string | null;
  workspaceId: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  resolveDescription?: (tx: Prisma.TransactionClient) => Promise<string | null>;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  assigneeAuthorization?: TaskAssigner;
  /**
   * Organization workspaces only. Personal workspaces must omit / stay PUBLIC.
   * Immutable after create.
   */
  visibility?: "PUBLIC" | "PRIVATE";
  priority?: TaskPriority;
  status:
    | typeof TaskStatus.DRAFT
    | typeof TaskStatus.QUEUED
    | typeof TaskStatus.READY;
  /** Set together with QUEUED: the one time the Task moves to Ready. */
  runAt?: Date | null;
  channel?: Channel;
  /** Server-reserved effect identity, committed with this operation. */
  effectEventId?: string;
}

export interface UpdateTaskDomainInput {
  actor: TaskDomainActor;
  /**
   * The person the actor acts as: the user, or the Soko Bot's person. Null
   * only for a shared Soko Bot acting on its own (ADR 0057).
   */
  userId: string | null;
  /** Required for Soko Bot. User routes retain owner-scoped PATCH semantics. */
  workspaceId?: string;
  taskId: string;
  intent: "metadata" | "assignment";
  name?: string;
  description?: string | null;
  projectId?: string | null;
  expectedUpdatedAt?: Date;
  archive?: boolean;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  status?: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
  channel?: Channel;
  /** Server-reserved effect identity, committed with this operation. */
  effectEventId?: string;
}

interface PendingGrantState {
  pendingVendorGrantId: string;
  grantResumeStatus: GrantResumeStatus;
}

function requireAssigneeXor(
  assigneeId: string | null | undefined,
  assigneeSokoBotId: string | null | undefined,
  assigneeUserId?: string | null | undefined,
): void {
  if (countSetAssignees(assigneeId, assigneeSokoBotId, assigneeUserId) > 1) {
    throw unprocessableEntity(
      "Task cannot be assigned to more than one assignee",
    );
  }
}

export function requireNoHumanAssigneeOnPrivateTask(
  visibility: TaskVisibility,
  assigneeUserId: string | null | undefined,
): void {
  if (
    visibility === TaskVisibility.PRIVATE &&
    hasAssigneeValue(assigneeUserId)
  ) {
    throw badRequest("Private Tasks cannot be assigned to a human teammate");
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
    isAgentOnlyTaskStatus(status) &&
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

export async function requireTaskReferences(
  input: {
    projectId?: string | null;
    assigneeId?: string | null;
    assigneeSokoBotId?: string | null;
    assigneeUserId?: string | null;
    workspaceId: string;
    actor: TaskDomainActor;
    assigneeAuthorization?: TaskAssigner;
    /** The Task as it will be after the write; a shared bot gates on it. */
    assignedTask?: AssignedTask;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  await requireProjectInWorkspace(input.projectId, input.workspaceId, tx);
  if (input.assigneeId !== null && input.assigneeId !== undefined) {
    await requireTaskAssignableCoworker(
      input.assigneeId,
      input.workspaceId,
      tx,
      input.assigneeAuthorization ?? taskAssigner(input.actor),
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
      input.assignedTask,
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
 * A shared Soko Bot works for its whole scope, so its Tasks are always PUBLIC.
 * Read only when PRIVATE is asked for, so other creates cost no query.
 */
async function isSharedSokoBotActor(
  actor: TaskDomainActor,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (actor.kind !== "soko_bot") return false;
  const bot = await tx.sokoBot.findUnique({
    where: { id: actor.sokoBotId },
    select: { userId: true },
  });
  return bot !== null && isSharedSokoBot(bot);
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
  if (input.ownerId === null && !(await isSharedSokoBotActor(input.actor, tx)))
    throw badRequest("Only a shared Soko Bot makes a Task without an Owner");
  const visibility =
    input.visibility === "PRIVATE" &&
    input.organizationId != null &&
    !(await isSharedSokoBotActor(input.actor, tx))
      ? TaskVisibility.PRIVATE
      : TaskVisibility.PUBLIC;

  if (input.visibility === "PRIVATE" && input.organizationId == null) {
    throw badRequest(
      "Private Tasks are only allowed in organization workspaces",
    );
  }
  requireNoHumanAssigneeOnPrivateTask(visibility, input.assigneeUserId);
  await requireTaskReferences(
    {
      ...input,
      assignedTask: { visibility, projectId: input.projectId ?? null },
    },
    tx,
  );
  const pendingGrant = await resolvePendingGrant(input, tx);
  const status = pendingGrant ? TaskStatus.GRANT_PENDING : input.status;
  // GRANT_PENDING is agent-only. A delegated create that parks for a vendor
  // grant and omitted assigneeId still belongs to the acting coworker.
  const hasUserAssignee = hasAssigneeValue(input.assigneeUserId);
  const hasAgentAssignee =
    hasAssigneeValue(input.assigneeId) ||
    hasAssigneeValue(input.assigneeSokoBotId);
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
      visibility,
      priority: input.priority,
      grantResumeStatus: pendingGrant?.grantResumeStatus ?? null,
      pendingVendorGrantId: pendingGrant?.pendingVendorGrantId ?? null,
      runAt: input.runAt ?? null,
      events: {
        create: taskCreationEvents({
          status,
          channel: input.channel ?? Channel.SOKOSUMI,
          actorFields: eventActorFields(input.actor),
          statusEventId: input.effectEventId,
        }),
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

/**
 * The live Task an actor may change. A user changes their own Tasks here; a
 * Soko Bot changes what its owner could change in the app (their own Tasks,
 * and public Tasks of an organization they hold a seat in), and only inside
 * the bot's own workspace. Archiving is managing the Task.
 */
async function findActorTask(
  input: UpdateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  if (input.actor.kind === "soko_bot" && input.userId === null)
    return findSharedSokoBotTask(input, input.actor.sokoBotId, tx);
  if (input.userId === null) throw notFound("Task not found");
  if (input.actor.kind === "soko_bot") {
    const task = await requireTaskWriteAccess(
      { source: "context", userId: input.userId, organizationId: null },
      input.taskId,
      tx,
      { right: input.archive ? "manage" : "edit" },
    );
    if (task.workspaceId !== input.workspaceId)
      throw notFound("Task not found");
    return task;
  }
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      ownerId: input.userId,
      archivedAt: null,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
  });
  if (!task) throw notFound("Task not found");
  return task;
}

/**
 * A shared Soko Bot acting on its own edits the public Tasks of its scope:
 * work without an Owner is editable (ADR 0057). Managing it needs an
 * Organization owner or admin, so archiving is refused.
 */
async function findSharedSokoBotTask(
  input: UpdateTaskDomainInput,
  sokoBotId: string,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  if (input.archive)
    throw forbidden("Archiving a Task needs an Organization owner or admin");
  const bot = await tx.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { id: true, userId: true, workspaceId: true, projectId: true },
  });
  const scope = bot ? sokoBotSharedScopeOf(bot) : null;
  if (!scope || scope.workspaceId !== input.workspaceId)
    throw notFound("Task not found");
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      archivedAt: null,
      ...buildSokoBotScopeTaskWhere(scope),
    },
  });
  if (!task) throw notFound("Task not found");
  return task;
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
  const task = await findActorTask(input, tx);
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

/** Shared archive mutation after the caller has established archive access. */
export async function archiveTaskRecord(
  tx: Prisma.TransactionClient,
  task: Task,
  options: {
    expectedUpdatedAt?: Date;
    actor?: TaskDomainActor;
    effectEventId?: string;
  } = {},
): Promise<void> {
  if (!canArchiveTaskStatus(task.status))
    throw unprocessableEntity(getTaskCannotArchiveMessage(task.status));
  // A generated Task is independent of its recurring parent (ADR 0041).
  // The bot must not cancel a future one-off run as a side effect of archive.
  if (
    options.actor?.kind === "soko_bot" &&
    task.runAt &&
    task.runAt > new Date()
  ) {
    throw unprocessableEntity(
      "Remove the future Run at before archiving this Task",
    );
  }
  if (
    options.expectedUpdatedAt &&
    task.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()
  )
    throw conflict("Task changed; read it again");
  const result = await tx.task.updateMany({
    where: {
      id: task.id,
      archivedAt: null,
      status: task.status,
      updatedAt: task.updatedAt,
    },
    data: { archivedAt: new Date() },
  });
  if (result.count !== 1)
    throw conflict("Task was modified concurrently; retry archive");
  if (options.effectEventId && options.actor) {
    await tx.taskEvent.create({
      data: {
        id: options.effectEventId,
        taskId: task.id,
        comment: "Task archived",
        ...eventActorFields(options.actor),
      },
    });
  }
}

/**
 * Canonical metadata/assignment operation. Soko Bot stays inside its bounded
 * pre-execution state ceiling; owner route keeps existing editable-state rules.
 */
export async function updateTaskForActor(
  input: UpdateTaskDomainInput,
  tx: Prisma.TransactionClient,
): Promise<Task> {
  if (input.archive || input.projectId !== undefined) {
    if (!input.expectedUpdatedAt && input.actor.kind === "soko_bot") {
      throw unprocessableEntity(
        "Read the task first and supply expectedUpdatedAt for a move or archive",
      );
    }
  }
  const projectMoveOnly =
    input.actor.kind === "soko_bot" &&
    input.projectId !== undefined &&
    input.name === undefined &&
    input.description === undefined &&
    input.status === undefined &&
    input.assigneeId === undefined &&
    input.assigneeSokoBotId === undefined &&
    input.assigneeUserId === undefined;
  if (
    input.archive &&
    (input.projectId !== undefined ||
      input.name !== undefined ||
      input.description !== undefined ||
      input.status !== undefined)
  ) {
    throw unprocessableEntity("Archive must be a separate operation");
  }
  if (projectMoveOnly && !input.archive) {
    const task = await findActorTask(input, tx);
    if (
      input.expectedUpdatedAt &&
      task.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    )
      throw conflict("Task changed; read it again");
    await requireProjectInWorkspace(input.projectId, task.workspaceId, tx);
    return tx.task.update({
      where: { id: task.id, updatedAt: task.updatedAt },
      data: {
        projectId: input.projectId,
        events: input.effectEventId
          ? {
              create: {
                id: input.effectEventId,
                comment: "Task moved to a project",
                ...eventActorFields(input.actor),
              },
            }
          : undefined,
      },
    });
  }
  if (input.archive) {
    const task = await findActorTask(input, tx);
    if (input.actor.kind === "coworker")
      throw forbidden("Coworkers cannot archive tasks");
    await archiveTaskRecord(tx, task, {
      expectedUpdatedAt: input.expectedUpdatedAt,
      actor: input.actor,
      effectEventId: input.effectEventId,
    });
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  }

  const task = await requireMutableTask(input, tx);
  if (
    input.expectedUpdatedAt &&
    task.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  )
    throw conflict("Task changed; read it again");
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
  requireNoHumanAssigneeOnPrivateTask(task.visibility, nextAssigneeUserId);

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
      assignedTask: {
        visibility: task.visibility,
        projectId:
          input.projectId !== undefined ? input.projectId : task.projectId,
      },
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
        input.effectEventId ||
        (input.status !== undefined && input.status !== task.status)
          ? {
              create: {
                id: input.effectEventId,
                status: input.status !== task.status ? input.status : undefined,
                comment:
                  input.effectEventId &&
                  (input.status === undefined || input.status === task.status)
                    ? "Task updated"
                    : undefined,
                channel: input.channel ?? Channel.SOKOSUMI,
                ...eventActorFields(input.actor),
              },
            }
          : undefined,
    },
  });
}
