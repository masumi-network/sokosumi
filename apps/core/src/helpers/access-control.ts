import {
  type Job,
  MemberRole,
  type Prisma,
  type Task,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isOrchestratorAuthContext,
  isUserAuthContext,
  requireCoworkerAuthContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";

import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";

import type { CoworkerCapability } from "./coworker-capability";
import { forbidden, notFound } from "./error";
import { resolveMemberOrganizationById } from "./organization";
import {
  getWorkspaceGrant,
  requestWorkspaceGrantCommitted,
  requireTaskNotParked,
  throwGrantAccessError,
} from "./vendor-grants";
import { buildCoworkerAuthorizedTaskWhere } from "./vendor-siblings";

// -----------------------------------------------------------------------------
// User ownership (resource belongs to the authenticated user)
// -----------------------------------------------------------------------------

/**
 * Validates that the job exists and is owned by the authenticated user.
 *
 * @throws {forbidden} If the job is not owned by the user
 */
export async function requireJobOwnership(
  userContext: UserContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const job = await tx.job.findFirst({
    where: {
      id: jobId,
      userId: userContext.userId,
    },
  });

  if (!job) {
    throw forbidden("You can only access your own jobs");
  }
  return job;
}

/**
 * Validates that the task exists, is not archived, and is owned by the authenticated user.
 *
 * @throws {notFound} If the task does not exist or is not owned by the user
 */
export async function requireTaskOwnership(
  userContext: UserContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      userId: userContext.userId,
      archivedAt: null,
    },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Owner mutations that must not run while the task is parked awaiting
 * vendor workspace grant approval (metadata, links, share, schedule, move, …).
 * Soft-archive uses {@link requireTaskArchiveAccess} instead.
 */
export async function requireMutableTaskOwnership(
  userContext: UserContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await requireTaskOwnership(userContext, taskId, tx);
  requireTaskNotParked(task);
  return task;
}

/**
 * Soft-archive access: task owner always, or org OWNER/ADMIN when the task is
 * parked (`GRANT_PENDING`) in that organization workspace.
 */
export async function requireTaskArchiveAccess(
  userContext: UserContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const owned = await tx.task.findFirst({
    where: {
      id: taskId,
      userId: userContext.userId,
      archivedAt: null,
    },
  });

  if (owned) {
    return owned;
  }

  const parked = await tx.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
      status: TaskStatus.GRANT_PENDING,
    },
    include: {
      workspace: { select: { organizationId: true } },
    },
  });

  if (!parked?.workspace.organizationId) {
    throw notFound("Task not found");
  }

  await resolveMemberOrganizationById({
    id: parked.workspace.organizationId,
    userId: userContext.userId,
    tx,
    allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
  });

  return parked;
}

// -----------------------------------------------------------------------------
// Coworker capability (usable coworker + capability / assignment readiness)
// -----------------------------------------------------------------------------

async function findUsableCoworkerByCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
  options?: {
    requireBaseUrl?: boolean;
  },
) {
  return await tx.coworker.findFirst({
    where: {
      id: coworkerId,
      archivedAt: null,
      isWhitelisted: true,
      capabilities: {
        has: capability,
      },
      ...(options?.requireBaseUrl ? { baseURL: { not: null } } : {}),
    },
    select: {
      id: true,
      slug: true,
      baseURL: true,
    },
  });
}

export async function requireCoworkerCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    capability,
    tx,
  );

  if (!coworker) {
    throw forbidden(`Coworker is not allowed to use ${capability}`);
  }
}

export async function requireCoworkerChatCapability(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  id: string;
  slug: string;
  baseURL: string | null;
}> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    "chat",
    tx,
    {
      requireBaseUrl: true,
    },
  );

  if (!coworker) {
    throw forbidden("Coworker chat is not available");
  }

  return coworker;
}

export async function requireTaskAssignableCoworker(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    "tasks",
    tx,
  );

  if (!coworker) {
    throw notFound("Coworker not found");
  }
}

// -----------------------------------------------------------------------------
// Task collaboration (user ownership or coworker on assigned task)
// -----------------------------------------------------------------------------

async function requestWorkspaceGrantIndependently(params: {
  vendorId: string;
  workspaceId: string;
  requestedByUserId: string | null;
}) {
  return requestWorkspaceGrantCommitted(params);
}

async function requireGrantedWorkspaceAccessOrRequest(params: {
  vendorId: string;
  workspaceId: string;
  requestedByUserId: string | null;
  grant: Awaited<ReturnType<typeof getWorkspaceGrant>>;
}): Promise<void> {
  const { vendorId, workspaceId, requestedByUserId, grant } = params;

  if (grant?.status === VendorGrantStatus.GRANTED) {
    return;
  }

  if (
    grant?.status === VendorGrantStatus.DENIED ||
    grant?.status === VendorGrantStatus.REVOKED
  ) {
    throwGrantAccessError(grant.status);
  }

  const { grant: grantAfterRequest } = await requestWorkspaceGrantIndependently(
    {
      vendorId,
      workspaceId,
      requestedByUserId,
    },
  );

  if (grantAfterRequest.status === VendorGrantStatus.GRANTED) {
    return;
  }

  throwGrantAccessError(grantAfterRequest.status);
}

async function requireCoworkerTaskRead(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  workspaceId: string | null,
  tx?: Prisma.TransactionClient,
): Promise<Task>;
async function requireCoworkerTaskRead<I extends Prisma.TaskInclude>(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  workspaceId: string | null,
  tx: Prisma.TransactionClient,
  include: I,
): Promise<Prisma.TaskGetPayload<{ include: I }>>;
async function requireCoworkerTaskRead(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  workspaceId: string | null,
  tx: Prisma.TransactionClient = prisma,
  include?: Prisma.TaskInclude,
): Promise<Task> {
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);

  const baselineTask = await tx.task.findFirst({
    where: buildCoworkerAuthorizedTaskWhere({
      taskId,
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      workspaceId,
    }),
    ...(include ? { include } : {}),
  });

  if (baselineTask) {
    return baselineTask;
  }

  if (!workspaceId) {
    throw notFound("Task not found");
  }

  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      workspaceId,
      archivedAt: null,
      status: { not: TaskStatus.DRAFT },
    },
    ...(include ? { include } : {}),
  });

  if (!task) {
    throw notFound("Task not found");
  }

  const grant = await getWorkspaceGrant(
    {
      vendorId: authContext.vendorId,
      workspaceId,
    },
    tx,
  );

  await requireGrantedWorkspaceAccessOrRequest({
    vendorId: authContext.vendorId,
    workspaceId,
    requestedByUserId: authContext.context?.userId ?? null,
    grant,
  });

  return task;
}

/**
 * Coworker branch of task read: tasks capability, task exists (non-draft), and assignment to this coworker.
 */
async function requireCoworkerAssignedTaskRead(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);

  const task = await tx.task.findUnique({
    where: {
      id: taskId,
      status: { not: TaskStatus.DRAFT },
      archivedAt: null,
    },
  });
  if (!task) {
    throw notFound("Task not found");
  }
  if (task.coworkerId !== authContext.coworkerId) {
    throw forbidden("You can only access tasks assigned to your coworker");
  }

  return task;
}

/**
 * Coworker branch of task collaboration: tasks capability, task exists (non-draft), and assignment to this coworker.
 *
 * @param authContext - The authenticated coworker context
 * @param taskId - The task ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated task when collaboration is permitted
 * @throws {notFound} If the task does not exist
 * @throws {forbidden} If the coworker lacks capability or is not assigned to the task
 *
 * @example
 * const task = await requireCoworkerTaskCollaboration(authContext, taskId);
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireCoworkerTaskCollaboration(authContext, taskId, tx);
 *   // ... additional operations
 * });
 */
export async function requireCoworkerTaskCollaboration(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await requireCoworkerAssignedTaskRead(authContext, taskId, tx);
  requireTaskNotParked(task);
  return task;
}

/**
 * Collaboration access: the authenticated user must own the task, or the authenticated coworker must be allowed on the task (tasks capability + assignment).
 */
export async function requireTaskCollaboration(
  authContext: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  if (
    isUserAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
    const userContext = requireUserContext(authContext);
    const task = await requireTaskOwnership(userContext, taskId, tx);
    requireTaskNotParked(task);
    return task;
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.context) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const task = await requireTaskOwnership(
      {
        source: "context",
        userId: coworker.context.userId,
        organizationId: coworker.context.organizationId,
      },
      taskId,
      tx,
    );

    if (task.coworkerId !== coworker.coworkerId) {
      throw forbidden("You can only act on tasks assigned to your coworker");
    }

    requireTaskNotParked(task);
    return task;
  }

  return await requireCoworkerTaskCollaboration(coworker, taskId, tx);
}

export async function requireTaskCommentAccess(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const { authContext, workspaceContext } = vars;

  if (
    isUserAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
    requireUserContext(authContext);
    const task = await requireTaskReadForWorkspace(
      requireWorkspaceContext(workspaceContext),
      taskId,
      tx,
    );
    requireTaskNotParked(task);
    return task;
  }

  const coworker = requireCoworkerAuthContext(authContext);
  const workspaceId =
    coworker.context && workspaceContext
      ? requireWorkspaceContext(workspaceContext).workspaceId
      : null;

  const task = await requireCoworkerTaskRead(coworker, taskId, workspaceId, tx);
  requireTaskNotParked(task);

  return task;
}

// -----------------------------------------------------------------------------
// Workspace-scoped reads (task/job in the active workspace)
// -----------------------------------------------------------------------------

/**
 * Workspace-scoped task read: task must belong to the active workspace.
 * Call from handlers after `requireWorkspaceContext`. For user or coworker reads from route vars, use `requireTaskReadForRouteVars`.
 */
export async function requireTaskReadForWorkspace(
  workspaceContext: WorkspaceContext,
  taskId: string,
  tx?: Prisma.TransactionClient,
): Promise<Task>;
export async function requireTaskReadForWorkspace<I extends Prisma.TaskInclude>(
  workspaceContext: WorkspaceContext,
  taskId: string,
  tx: Prisma.TransactionClient,
  include: I,
): Promise<Prisma.TaskGetPayload<{ include: I }>>;
export async function requireTaskReadForWorkspace(
  workspaceContext: WorkspaceContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
  include?: Prisma.TaskInclude,
): Promise<Task> {
  const { workspaceId } = workspaceContext;

  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
      workspaceId,
    },
    ...(include ? { include } : {}),
  });

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Task read for a workspace-scoped user or an assigned coworker with the tasks capability.
 * Pass the route `Variables` object (e.g. `c.var` from `OpenAPIHonoWithAuth`). Delegates to `requireTaskReadForWorkspace` or coworker assignment read helpers.
 */
export async function requireTaskReadForRouteVars(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx?: Prisma.TransactionClient,
): Promise<Task>;
export async function requireTaskReadForRouteVars<I extends Prisma.TaskInclude>(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient,
  include: I,
): Promise<Prisma.TaskGetPayload<{ include: I }>>;
export async function requireTaskReadForRouteVars(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
  include?: Prisma.TaskInclude,
): Promise<Task> {
  const { authContext, workspaceContext } = vars;

  if (
    isUserAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
    requireUserContext(authContext);
    const workspace = requireWorkspaceContext(workspaceContext);
    if (include) {
      return await requireTaskReadForWorkspace(workspace, taskId, tx, include);
    }
    return await requireTaskReadForWorkspace(workspace, taskId, tx);
  }

  const coworker = requireCoworkerAuthContext(authContext);
  const workspaceId =
    coworker.context && workspaceContext
      ? requireWorkspaceContext(workspaceContext).workspaceId
      : null;

  if (include) {
    return await requireCoworkerTaskRead(
      coworker,
      taskId,
      workspaceId,
      tx,
      include,
    );
  }

  return await requireCoworkerTaskRead(coworker, taskId, workspaceId, tx);
}

/**
 * Workspace-scoped job read: job must belong to the active workspace.
 * Pass the context from `requireWorkspaceContext` (workspace middleware).
 */
export async function requireJobRead(
  workspaceContext: WorkspaceContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const { workspaceId } = workspaceContext;

  const job = await tx.job.findFirst({
    where: {
      id: jobId,
      workspaceId,
    },
  });

  if (!job) {
    throw notFound("Job not found");
  }

  return job;
}

// -----------------------------------------------------------------------------
// Conversation delegation (coworker may only act on its own conversations)
// -----------------------------------------------------------------------------

/**
 * Resolves the coworker a conversation is bound to from its metadata.
 *
 * Conversations record their coworker via `coworker_id` (written once the first
 * coworker response is persisted) and/or `coworker_slug` (set when the
 * conversation is created). Prefers the stable `coworker_id`; falls back to
 * resolving `coworker_slug` to an id.
 *
 * @returns The bound coworker id, or `null` when the conversation has no usable
 *   coworker binding.
 */
export async function resolveConversationCoworkerId(
  metadata: Prisma.JsonValue | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const id =
    typeof meta.coworker_id === "string" ? meta.coworker_id : undefined;
  if (id) {
    return id;
  }

  const slug =
    typeof meta.coworker_slug === "string" ? meta.coworker_slug : undefined;
  if (!slug) {
    return null;
  }

  const coworker = await tx.coworker.findFirst({
    where: { slug, archivedAt: null },
    select: { id: true },
  });
  return coworker?.id ?? null;
}

/**
 * Per-resource authorization for chat/conversation access.
 *
 * - User actors: no-op — ownership is already enforced by the `userId`-scoped
 *   query that loaded the conversation.
 * - Orchestrator actors: always forbidden (marketplace chat is out of scope).
 * - Delegated coworker actors: the conversation's bound coworker
 *   (`metadata.coworker_id` / `coworker_slug`) must equal the authenticated
 *   `coworkerId`. Delegation alone (user-exists + org-membership) is not enough;
 *   a coworker may only act on conversations assigned to it.
 *
 * Non-delegated coworkers never reach this on user-scoped routes
 * (`requireUserContext` throws first); the delegation branch guards defensively.
 *
 * @throws {forbidden} When the actor is an orchestrator, or a delegated coworker
 *   is not the conversation's coworker.
 */
export async function requireConversationCoworkerAccess(
  authContext: AuthenticationContext,
  metadata: Prisma.JsonValue | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (isOrchestratorAuthContext(authContext)) {
    throw forbidden("Orchestrator cannot access marketplace conversations");
  }

  if (isUserAuthContext(authContext)) {
    return;
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (!coworker.context) {
    throw forbidden(
      "Context headers (X-Context-User-Id) are required for this resource",
    );
  }

  const conversationCoworkerId = await resolveConversationCoworkerId(
    metadata,
    tx,
  );
  if (
    !conversationCoworkerId ||
    conversationCoworkerId !== coworker.coworkerId
  ) {
    throw forbidden(
      "You can only access conversations assigned to your coworker",
    );
  }
}

/**
 * Pins a conversation's coworker binding to the acting coworker when the request
 * is delegated. For coworker actors this stamps `coworker_id` to the
 * authenticated coworker and drops any client-supplied `coworker_slug`, so the
 * binding cannot diverge (the chat handler resolves the coworker from
 * `coworker_id`; the real slug is derived from it). No-op for user sessions.
 *
 * Mutates and returns the passed metadata object.
 */
export function pinCoworkerConversationBinding(
  authContext: AuthenticationContext,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (isOrchestratorAuthContext(authContext)) {
    throw forbidden("Orchestrator cannot access marketplace conversations");
  }

  if (isUserAuthContext(authContext)) {
    return metadata;
  }

  metadata.coworker_id = requireCoworkerAuthContext(authContext).coworkerId;
  delete metadata.coworker_slug;
  return metadata;
}

// -----------------------------------------------------------------------------
// Job collaboration (delegated coworker must be assigned to the job's task)
// -----------------------------------------------------------------------------

/**
 * A delegated coworker may only act on a job whose task is assigned to that
 * coworker. Jobs have no direct coworker; the relationship is
 * `Job.taskId -> Task.coworkerId`. Jobs without a task, or whose task is
 * assigned to a different coworker, are denied.
 *
 * Used for job **writes** only. Job reads also allow same-vendor siblings via
 * {@link assertCoworkerCanReadJob}.
 *
 * @throws {forbidden} If the job is not attached to a task assigned to the coworker
 */
async function assertJobAssignedToCoworker(
  job: Job,
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (job.taskId === null) {
    throw forbidden("You can only access jobs assigned to your coworker");
  }

  const task = await tx.task.findFirst({
    where: { id: job.taskId },
    select: { coworkerId: true },
  });

  if (task?.coworkerId !== coworkerId) {
    throw forbidden("You can only access jobs assigned to your coworker");
  }
}

async function assertCoworkerCanReadJob(
  coworker: CoworkerAuthenticationContext,
  job: Job,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (job.taskId === null) {
    throw forbidden("You can only access jobs assigned to your coworker");
  }

  await requireCoworkerTaskRead(coworker, job.taskId, job.workspaceId, tx);
}

/**
 * Job read for a workspace-scoped user or a coworker with assignee / same-vendor sibling access.
 */
export async function requireJobReadForRouteVars(
  vars: EnvVariables["Variables"],
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const { authContext, workspaceContext } = vars;

  if (
    isUserAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
    requireUserContext(authContext);
    return await requireJobRead(
      requireWorkspaceContext(workspaceContext),
      jobId,
      tx,
    );
  }

  const coworker = requireCoworkerAuthContext(authContext);
  await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

  if (coworker.context) {
    const workspace = requireWorkspaceContext(workspaceContext);
    const job = await requireJobRead(workspace, jobId, tx);
    await assertCoworkerCanReadJob(coworker, job, tx);
    return job;
  }

  const job = await tx.job.findFirst({
    where: { id: jobId },
  });
  if (!job) {
    throw notFound("Job not found");
  }

  await assertCoworkerCanReadJob(coworker, job, tx);
  return job;
}

async function requireParentTaskNotParked(
  job: Pick<Job, "taskId">,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (job.taskId == null) {
    return;
  }

  const task = await tx.task.findFirst({
    where: { id: job.taskId, archivedAt: null },
    select: { status: true },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  requireTaskNotParked(task);
}

/**
 * Collaboration (write) access for a job: the authenticated user must own the
 * job, or the delegated coworker must have the tasks capability and be assigned
 * to the job's task. Mirrors `requireTaskCollaboration` for jobs.
 *
 * @throws {forbidden} If the user does not own the job, a bare coworker is used,
 *   a delegated coworker is not assigned to the job's task, or the parent task
 *   is parked
 */
export async function requireJobCollaboration(
  authContext: AuthenticationContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  if (
    isUserAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
    const userContext = requireUserContext(authContext);
    const job = await requireJobOwnership(userContext, jobId, tx);
    await requireParentTaskNotParked(job, tx);
    return job;
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.context) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const job = await requireJobOwnership(
      {
        source: "context",
        userId: coworker.context.userId,
        organizationId: coworker.context.organizationId,
      },
      jobId,
      tx,
    );

    await assertJobAssignedToCoworker(job, coworker.coworkerId, tx);
    await requireParentTaskNotParked(job, tx);

    return job;
  }

  // Bare coworkers (no context headers) have no user/workspace context for jobs.
  throw forbidden(
    "Context headers (X-Context-User-Id) are required for this resource",
  );
}
