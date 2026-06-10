import { type Job, type Prisma, type Task } from "@sokosumi/database";
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

    return task;
  }

  return await requireCoworkerTaskCollaboration(coworker, taskId, tx);
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

    // Delegation only authorizes reads of tasks assigned to this coworker.
    if (task.coworkerId !== coworker.coworkerId) {
      throw forbidden("You can only access tasks assigned to your coworker");
    }

    return task;
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
