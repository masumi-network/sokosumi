import {
  type Job,
  type Prisma,
  type Task,
  TaskStatus,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isCoworkerAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

import type { WorkspaceContext } from "@/middleware/workspace";

import type { CoworkerCapability } from "./coworker-capability";
import { forbidden, notFound } from "./error";

/**
 * Validates that the job exists and is owned by the authenticated user.
 *
 * @throws {forbidden} If the job is not owned by the user
 */
export async function requireJobOwnership(
  authContext: UserAuthenticationContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const job = await tx.job.findFirst({
    where: {
      id: jobId,
      userId: authContext.userId,
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
  authContext: UserAuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      userId: authContext.userId,
      archivedAt: null,
    },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Validates access to a task based on coworker ownership and fetches the task record.
 * Throws 403 if the authenticated coworker does not have access to the task.
 *
 * @param authContext - The authenticated coworker context
 * @param taskId - The task ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated task if access is permitted
 * @throws {notFound} If the task does not exist
 * @throws {forbidden} If coworker does not have access to the task
 *
 * @example
 * const task = await requireCoworkerTaskAccess(authContext, taskId);
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireCoworkerTaskAccess(authContext, taskId, tx);
 *   // ... additional operations
 * });
 */
export async function requireCoworkerTaskAccess(
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
): Promise<{ id: string; slug: string; baseURL: string | null }> {
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

/**
 * Validates access to a task based on the authentication context (user or coworker)
 * and fetches the task record. Directs to the appropriate access control depending
 * on whether the request comes from a user or a coworker.
 *
 * Throws 403 if the authenticated user or coworker does not have access to the task.
 *
 * @param authContext - The authentication context of the current user or coworker
 * @param taskId - The ID of the task to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support (defaults to main Prisma client)
 * @returns The validated task if access is permitted
 * @throws {notFound} If the task does not exist
 * @throws {forbidden} If the user or coworker does not have access to the task
 *
 * @example
 * const task = await requireTaskAccess(authContext, taskId);
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireTaskAccess(authContext, taskId, tx);
 *   // ... additional operations
 * });
 */
export async function requireTaskAccess(
  authContext: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  if (isCoworkerAuthContext(authContext)) {
    return await requireCoworkerTaskAccess(authContext, taskId, tx);
  }
  return await requireTaskOwnership(authContext, taskId, tx);
}

/**
 * Read access: task must belong to the active workspace (user) or assigned coworker (coworker).
 * For user requests, pass the context from `requireWorkspaceContext`. For coworkers, pass `null`.
 */
export async function requireTaskReadAccess(
  authContext: AuthenticationContext,
  workspaceContext: WorkspaceContext | null,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  if (isCoworkerAuthContext(authContext)) {
    return await requireCoworkerTaskAccess(authContext, taskId, tx);
  }

  if (!workspaceContext) {
    throw forbidden("Workspace is missing");
  }

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
 * Read access: job must belong to the active workspace.
 * Pass the context from `requireWorkspaceContext` (workspace middleware).
 */
export async function requireJobReadAccess(
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
