import {
  CoworkerWorkspaceAccessStatus,
  type Job,
  MemberRole,
  type Prisma,
  type Task,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { hasActiveTaskSchedule } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
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
import { buildAccessibleCoworkerMembershipOr } from "./vendor-membership";
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
      ownerId: userContext.userId,
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
      ownerId: userContext.userId,
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
 * Soft-archive access: task owner always; org OWNER/ADMIN for parked
 * (`GRANT_PENDING`); for active schedules, any org-workspace member for a
 * task in that workspace (same active-workspace gate as
 * {@link requireTaskCancelAccess}). Coworker actors are out (route uses
 * owner user context).
 */
export async function requireTaskArchiveAccess(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const userContext = requireUserContext(vars.authContext);

  const owned = await tx.task.findFirst({
    where: {
      id: taskId,
      ownerId: userContext.userId,
      archivedAt: null,
    },
  });

  if (owned) {
    return owned;
  }

  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
    },
    include: {
      workspace: { select: { organizationId: true } },
    },
  });

  const organizationId = task?.workspace.organizationId;
  if (!task || !organizationId) {
    throw notFound("Task not found");
  }

  const isParked = task.status === TaskStatus.GRANT_PENDING;
  const isScheduled = hasActiveTaskSchedule(task.metadata, task.nextRunAt);

  if (isParked) {
    await resolveMemberOrganizationById({
      id: organizationId,
      userId: userContext.userId,
      tx,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });
    return task;
  }

  if (!isScheduled) {
    throw notFound("Task not found");
  }

  // Match cancel: task must be in the active workspace; personal-workspace
  // non-owners are denied.
  const workspace = requireWorkspaceContext(vars.workspaceContext);
  const workspaceTask = await requireTaskReadForWorkspace(
    workspace,
    taskId,
    tx,
  );

  if (workspace.organizationId !== null) {
    return workspaceTask;
  }

  throw notFound("Task not found");
}

// -----------------------------------------------------------------------------
// Coworker capability (usable coworker + capability / assignment readiness)
// -----------------------------------------------------------------------------

/**
 * Human-side usability in a workspace: not archived AND (global whitelist OR
 * GRANTED CoworkerWorkspaceAccess for this workspace).
 */
export function buildCoworkerUsableInWorkspaceWhere(
  workspaceId: string,
): Prisma.CoworkerWhereInput {
  return {
    archivedAt: null,
    OR: [
      { isWhitelisted: true },
      {
        workspaceAccess: {
          some: {
            workspaceId,
            status: CoworkerWorkspaceAccessStatus.GRANTED,
          },
        },
      },
      // A user's Soko Bot is usable in their personal workspace and in every
      // organization workspace they belong to; dispatch still enforces that
      // only the owner can task it.
      {
        sokoBot: {
          archivedAt: null,
          user: {
            OR: [
              { workspace: { id: workspaceId } },
              {
                members: {
                  some: { organization: { workspace: { id: workspaceId } } },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

/** Hide other users' Soko Bots from coworker listings and pickers. */
export function buildSokoBotVisibilityWhere(
  userId: string,
): Prisma.CoworkerWhereInput {
  return { OR: [{ sokoBotId: null }, { sokoBot: { userId } }] };
}

/**
 * Prisma OR branches for coworkers a user may resolve by id (name chips,
 * enrichment) without enumerating private rows: marketplace whitelist, vendor
 * admin / assignment membership, or GRANTED workspace access on a personal or
 * org workspace the user belongs to.
 *
 * User-scoped (not single-workspace) — used when delegated workflows need
 * coworker metadata before a workspace is selected.
 */
export function buildCoworkerVisibleToUserOr(
  userId: string,
): Prisma.CoworkerWhereInput[] {
  return [
    { isWhitelisted: true },
    ...buildAccessibleCoworkerMembershipOr(userId),
    {
      workspaceAccess: {
        some: {
          status: CoworkerWorkspaceAccessStatus.GRANTED,
          workspace: {
            OR: [
              { userId },
              { organization: { members: { some: { userId } } } },
            ],
          },
        },
      },
    },
  ];
}

/**
 * Chat baseURL must be present and non-empty (spec: usability rule).
 * Does not reject whitespace-only strings at SQL layer — callers that need
 * that also run {@link hasNonEmptyBaseUrl}.
 */
export function buildCoworkerNonEmptyBaseUrlWhere(): Prisma.CoworkerWhereInput {
  return {
    AND: [{ baseURL: { not: null } }, { baseURL: { not: "" } }],
  };
}

export function hasNonEmptyBaseUrl(
  baseURL: string | null | undefined,
): baseURL is string {
  return typeof baseURL === "string" && baseURL.trim().length > 0;
}

/**
 * Actor API-key paths: active (non-archived) + capability only.
 * No global whitelist and no workspace-access row required.
 */
async function findActiveCoworkerByCapability(
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
      capabilities: {
        has: capability,
      },
      ...(options?.requireBaseUrl ? buildCoworkerNonEmptyBaseUrlWhere() : {}),
    },
    select: {
      id: true,
      slug: true,
      baseURL: true,
    },
  });
}

/**
 * Human pick/use in a workspace: whitelist OR GRANTED access, plus capability.
 */
export async function findUsableCoworkerByCapabilityInWorkspace(
  coworkerId: string,
  workspaceId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
  options?: {
    requireBaseUrl?: boolean;
  },
): Promise<{ id: string; slug: string; baseURL: string | null } | null> {
  return await tx.coworker.findFirst({
    where: {
      id: coworkerId,
      ...buildCoworkerUsableInWorkspaceWhere(workspaceId),
      capabilities: {
        has: capability,
      },
      ...(options?.requireBaseUrl ? buildCoworkerNonEmptyBaseUrlWhere() : {}),
    },
    select: {
      id: true,
      slug: true,
      baseURL: true,
    },
  });
}

/**
 * Actor routes: active + capability. No whitelist / workspace access gate.
 */
export async function requireCoworkerCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findActiveCoworkerByCapability(
    coworkerId,
    capability,
    tx,
  );

  if (!coworker) {
    throw forbidden(`Coworker is not allowed to use ${capability}`);
  }
}

/**
 * Actor chat helper: active + chat capability + baseURL. No whitelist.
 * Human chat-in-workspace uses {@link requireCoworkerChatCapabilityInWorkspace}.
 */
export async function requireCoworkerChatCapability(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  id: string;
  slug: string;
  baseURL: string | null;
}> {
  const coworker = await findActiveCoworkerByCapability(
    coworkerId,
    "chat",
    tx,
    {
      requireBaseUrl: true,
    },
  );

  if (!coworker || !hasNonEmptyBaseUrl(coworker.baseURL)) {
    throw forbidden("Coworker chat is not available");
  }

  return coworker;
}

/**
 * Human chat-in-workspace: whitelist OR GRANTED access, chat capability, baseURL.
 */
export async function requireCoworkerChatCapabilityInWorkspace(
  coworkerId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  id: string;
  slug: string;
  baseURL: string | null;
}> {
  const coworker = await findUsableCoworkerByCapabilityInWorkspace(
    coworkerId,
    workspaceId,
    "chat",
    tx,
    {
      requireBaseUrl: true,
    },
  );

  if (!coworker || !hasNonEmptyBaseUrl(coworker.baseURL)) {
    throw forbidden("Coworker chat is not available");
  }

  return coworker;
}

/**
 * Human task assign: coworker must be usable in the target workspace and have
 * the tasks capability.
 */
export async function requireTaskAssignableCoworker(
  coworkerId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findUsableCoworkerByCapabilityInWorkspace(
    coworkerId,
    workspaceId,
    "tasks",
    tx,
  );

  if (!coworker) {
    // Covers missing, archived, no tasks capability, and no whitelist/GRANTED
    // access in this workspace (including task moves into a foreign workspace).
    throw notFound("Coworker is not usable in this workspace");
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
  if (task.assigneeId !== authContext.coworkerId) {
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
  if (isUserAuthContext(authContext)) {
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

    if (task.assigneeId !== coworker.coworkerId) {
      throw forbidden("You can only act on tasks assigned to your coworker");
    }

    requireTaskNotParked(task);
    return task;
  }

  return await requireCoworkerTaskCollaboration(coworker, taskId, tx);
}

/**
 * Upload access for task files: task owner or the
 * assigned coworker (including coworker-with-context when they are the assignee).
 * Same rules as {@link requireTaskCollaboration}.
 */
export async function requireTaskFileUploadAccess(
  authContext: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  return await requireTaskCollaboration(authContext, taskId, tx);
}

export async function requireTaskCommentAccess(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const { authContext, workspaceContext } = vars;

  if (isUserAuthContext(authContext)) {
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

/**
 * Cancel access: task owner always, or any org-workspace member for a task in
 * that workspace. Personal-workspace non-owners are denied. Coworker actors
 * use the same rules as {@link requireTaskCollaboration}.
 */
export async function requireTaskCancelAccess(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const { authContext, workspaceContext } = vars;

  if (isUserAuthContext(authContext)) {
    const userContext = requireUserContext(authContext);
    const workspace = requireWorkspaceContext(workspaceContext);
    const task = await requireTaskReadForWorkspace(workspace, taskId, tx);
    requireTaskNotParked(task);

    if (task.ownerId === userContext.userId) {
      return task;
    }

    if (workspace.organizationId !== null) {
      return task;
    }

    throw notFound("Task not found");
  }

  return await requireTaskCollaboration(authContext, taskId, tx);
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

  if (isUserAuthContext(authContext)) {
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
 * - Delegated coworker actors: the conversation's bound coworker
 *   (`metadata.coworker_id` / `coworker_slug`) must equal the authenticated
 *   `coworkerId`. Delegation alone (user-exists + org-membership) is not enough;
 *   a coworker may only act on conversations assigned to it.
 *
 * Non-delegated coworkers never reach this on user-scoped routes
 * (`requireUserContext` throws first); the delegation branch guards defensively.
 *
 * @throws {forbidden} When a delegated coworker is not the conversation's coworker.
 */
export async function requireConversationCoworkerAccess(
  authContext: AuthenticationContext,
  metadata: Prisma.JsonValue | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
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
 * `Job.taskId -> Task.assigneeId`. Jobs without a task, or whose task is
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
    select: { assigneeId: true },
  });

  if (task?.assigneeId !== coworkerId) {
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

  if (isUserAuthContext(authContext)) {
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
  if (isUserAuthContext(authContext)) {
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
