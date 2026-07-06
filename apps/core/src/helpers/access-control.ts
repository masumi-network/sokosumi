import {
  CoworkerGrantScope,
  type Job,
  type Prisma,
  type Task,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isUserAuthContext,
  requireCoworkerAuthContext,
  type UserContext,
} from "@/middleware/auth";

import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";

import type { CoworkerCapability } from "./coworker-capability";
import {
  GRANT_REQUIRED_ERROR_KIND,
  hasCoworkerGrant,
  requestCoworkerGrant,
  requireCoworkerGrant,
} from "./coworker-grants";
import { forbidden, notFound } from "./error";

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
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);

  const task = await tx.task.findUnique({
    where: {
      id: taskId,
      status: { not: TaskStatus.DRAFT },
      // A task awaiting the owner's acceptance is inert for agents: no
      // reads, no events, and crucially no job attachment (= no spend)
      // until the owner accepts it.
      awaitingAcceptance: false,
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
 * Opt-in relaxations for delegated-coworker task access.
 */
export interface TaskAccessOptions {
  /**
   * Allow a delegated coworker (a coordinator like Hermes acting for a user
   * via delegation headers) to access tasks the delegated user owns even
   * when the task is assigned to a different coworker — IF the user has
   * granted the coworker this scope (see `CoworkerGrant`). Without the
   * grant the call fails with kind `grant_required` and a pending request
   * + notification are recorded for the user to approve.
   *
   * Reserved for low-risk surfaces — reads and comment-only events — so the
   * coordinator can follow up on tasks it filed for other coworkers (it is
   * never the assignee by design). Status transitions and billing must
   * never pass this; they stay assignment-gated. Non-delegated coworker
   * callers (the executing agents themselves) are unaffected.
   */
  unassignedDelegateGrant?: CoworkerGrantScope;
}

/**
 * Tasks awaiting the owner's acceptance are inert for EVERY coworker
 * context — bare agents and delegated coworkers alike (a delegated
 * coworker may be the very creator whose task is pending). Only the
 * owner's session sees or acts on them until accepted. 404 on purpose:
 * to agents the task does not exist yet.
 */
function requireNotAwaitingAcceptanceForCoworker<
  T extends { awaitingAcceptance: boolean },
>(task: T): T {
  if (task.awaitingAcceptance) {
    throw notFound("Task not found");
  }
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
    return await requireTaskOwnership(
      { source: "session", ...authContext },
      taskId,
      tx,
    );
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.delegation) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const task = await requireTaskOwnership(
      {
        source: "delegation",
        userId: coworker.delegation.userId,
        organizationId: coworker.delegation.organizationId,
      },
      taskId,
      tx,
    );

    // Delegation only authorizes collaboration on tasks assigned to this
    // coworker — not every task the delegated user owns.
    if (task.coworkerId !== coworker.coworkerId) {
      throw forbidden("You can only act on tasks assigned to your coworker");
    }

    return requireNotAwaitingAcceptanceForCoworker(task);
  }

  return await requireCoworkerTaskCollaboration(coworker, taskId, tx);
}

/** Result of {@link resolveTaskCommentAccess}. */
export interface TaskCommentAccess {
  task: Task;
  /**
   * Non-null when the caller is a delegated coworker without a TASK_COMMENT
   * grant and the request is (now) pending: the comment must be persisted
   * held under this grant id — visible only to the task owner until they
   * approve the grant (which releases it) or deny it (which deletes it).
   */
  heldByGrantId: string | null;
}

/**
 * Comment access on a task (comment-only events — never status/billing):
 * - session users: any member of the task's workspace may comment;
 * - delegated coworkers: any workspace task once the delegating user
 *   granted TASK_COMMENT (or the task is assigned to the coworker); while
 *   the grant request is pending, comments on the delegating user's OWN
 *   tasks are stored held for their approval, others are rejected;
 * - bare coworker agents: assigned tasks only (unchanged executor path).
 *
 * Throws 403 kind=grant_required only when the user already denied or
 * revoked the coworker's TASK_COMMENT access.
 */
export async function resolveTaskCommentAccess(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<TaskCommentAccess> {
  const { authContext, workspaceContext } = vars;

  if (isUserAuthContext(authContext)) {
    const task = await requireTaskReadForWorkspace(
      requireWorkspaceContext(workspaceContext),
      taskId,
      tx,
    );
    return { task, heldByGrantId: null };
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.delegation) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    // Granted commenting mirrors what the delegating user could do themself:
    // any task in the active workspace, not only tasks the user owns.
    const task = requireNotAwaitingAcceptanceForCoworker(
      await requireTaskReadForWorkspace(
        requireWorkspaceContext(workspaceContext),
        taskId,
        tx,
      ),
    );

    if (task.coworkerId === coworker.coworkerId) {
      return { task, heldByGrantId: null };
    }

    if (
      await hasCoworkerGrant(
        coworker.coworkerId,
        coworker.delegation.userId,
        CoworkerGrantScope.TASK_COMMENT,
        tx,
      )
    ) {
      return { task, heldByGrantId: null };
    }

    // No grant yet: request it (outside the caller's transaction). On tasks
    // the delegating user OWNS the comment is stored held under the pending
    // grant — the owner is exactly who resolves it. On a colleague's task a
    // hold would dangle (that owner cannot resolve this user's grant), so
    // the call is rejected until the delegating user grants the scope.
    const grantId = await requestCoworkerGrant(
      coworker.coworkerId,
      coworker.delegation.userId,
      CoworkerGrantScope.TASK_COMMENT,
    );
    if (grantId === null || task.userId !== coworker.delegation.userId) {
      // grantId null = the user already said no (denied/revoked never
      // auto-resurface).
      throw forbidden(
        "This coworker needs your approval for this action. Review the request under Connections → Coworker access.",
        {
          kind: GRANT_REQUIRED_ERROR_KIND,
          extensions: { scope: CoworkerGrantScope.TASK_COMMENT },
        },
      );
    }
    return { task, heldByGrantId: grantId };
  }

  const task = await requireCoworkerTaskCollaboration(coworker, taskId, tx);
  return { task, heldByGrantId: null };
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
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const { workspaceId } = workspaceContext;

  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
      workspaceId,
    },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Task read for a workspace-scoped user or an assigned coworker with the tasks capability.
 * Pass the route `Variables` object (e.g. `c.var` from `OpenAPIHonoWithAuth`). Delegates to `requireTaskReadForWorkspace` or `requireCoworkerTaskCollaboration`.
 */
export async function requireTaskReadForRouteVars(
  vars: EnvVariables["Variables"],
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
  options: TaskAccessOptions = {},
): Promise<Task> {
  const { authContext, workspaceContext } = vars;

  if (isUserAuthContext(authContext)) {
    return await requireTaskReadForWorkspace(
      requireWorkspaceContext(workspaceContext),
      taskId,
      tx,
    );
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.delegation) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const task = await requireTaskReadForWorkspace(
      requireWorkspaceContext(workspaceContext),
      taskId,
      tx,
    );

    // Delegation only authorizes reads of tasks assigned to this coworker,
    // unless the route opted into grant-gated unassigned access.
    if (task.coworkerId !== coworker.coworkerId) {
      if (!options.unassignedDelegateGrant) {
        throw forbidden("You can only access tasks assigned to your coworker");
      }
      await requireCoworkerGrant(
        coworker.coworkerId,
        coworker.delegation.userId,
        options.unassignedDelegateGrant,
        tx,
      );
    }

    return requireNotAwaitingAcceptanceForCoworker(task);
  }

  return await requireCoworkerTaskCollaboration(coworker, taskId, tx);
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
  if (!coworker.delegation) {
    throw forbidden("Delegation is required for this resource");
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
 * `Job.taskId -> Task.coworkerId`. Jobs without a task, or whose task is
 * assigned to a different coworker, are denied.
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

/**
 * Job read for a workspace-scoped user or an assigned coworker with the tasks
 * capability. Pass the route `Variables` object (e.g. `c.var` from
 * `OpenAPIHonoWithAuth`). Mirrors `requireTaskReadForRouteVars` for jobs.
 *
 * @throws {forbidden} If a bare coworker (no delegation) is used, or a delegated
 *   coworker is not assigned to the job's task
 * @throws {notFound} If the job is not in the active workspace
 */
export async function requireJobReadForRouteVars(
  vars: EnvVariables["Variables"],
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const { authContext, workspaceContext } = vars;

  if (isUserAuthContext(authContext)) {
    return await requireJobRead(
      requireWorkspaceContext(workspaceContext),
      jobId,
      tx,
    );
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.delegation) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const job = await requireJobRead(
      requireWorkspaceContext(workspaceContext),
      jobId,
      tx,
    );

    await assertJobAssignedToCoworker(job, coworker.coworkerId, tx);

    return job;
  }

  // Bare coworkers (no delegation) have no user/workspace context for jobs.
  throw forbidden(
    "Delegation headers (X-Delegation-User-Id) are required for this resource",
  );
}

/**
 * Collaboration (write) access for a job: the authenticated user must own the
 * job, or the delegated coworker must have the tasks capability and be assigned
 * to the job's task. Mirrors `requireTaskCollaboration` for jobs.
 *
 * @throws {forbidden} If the user does not own the job, a bare coworker is used,
 *   or a delegated coworker is not assigned to the job's task
 */
export async function requireJobCollaboration(
  authContext: AuthenticationContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  if (isUserAuthContext(authContext)) {
    return await requireJobOwnership(
      { source: "session", ...authContext },
      jobId,
      tx,
    );
  }

  const coworker = requireCoworkerAuthContext(authContext);
  if (coworker.delegation) {
    await requireCoworkerCapability(coworker.coworkerId, "tasks", tx);

    const job = await requireJobOwnership(
      {
        source: "delegation",
        userId: coworker.delegation.userId,
        organizationId: coworker.delegation.organizationId,
      },
      jobId,
      tx,
    );

    await assertJobAssignedToCoworker(job, coworker.coworkerId, tx);

    return job;
  }

  // Bare coworkers (no delegation) have no user/workspace context for jobs.
  throw forbidden(
    "Delegation headers (X-Delegation-User-Id) are required for this resource",
  );
}
