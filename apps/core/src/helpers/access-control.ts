import {
  type Job,
  type Prisma,
  type Task,
  TaskStatus,
  type User,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isCoworkerAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

import { forbidden, notFound } from "./error";
import {
  buildJobScopeFilters,
  buildTaskScopeFilters,
  type JobScope,
  type TaskScope,
} from "./scope";

/**
 * Validates job access and returns the job if valid
 * Checks both direct ownership and organization-level sharing
 * Throws 404 if job doesn't exist, 403 if user doesn't have access
 *
 * @param authContext - The authenticated user context
 * @param jobId - The job ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated job with all relations
 * @throws {notFound} If job doesn't exist
 * @throws {forbidden} If user doesn't have access to the job
 *
 * @example
 * // In a route handler
 * const job = await requireJobAccess(user.id, user.organizationId, jobId);
 *
 * @example
 * // With transaction
 * await prisma.$transaction(async (tx) => {
 *   const job = await requireJobAccess(user.id, user.organizationId, jobId, tx);
 *   // ... other operations within transaction
 * });
 */
export async function requireJobAccess(
  authContext: UserAuthenticationContext,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const job = await tx.job.findFirst({
    where: {
      OR: [
        { id: jobId, userId: authContext.userId },
        { id: jobId, share: { organizationId: authContext.organizationId } },
      ],
    },
  });

  if (!job) {
    throw forbidden(
      "You can only access your own jobs or jobs shared with your organization",
    );
  }
  return job;
}

/**
 * Validates user access and fetches the user record
 * Throws 403 if trying to access another user, 404 if user doesn't exist
 *
 * @param authenticatedUserId - The authenticated user's ID
 * @param requestedUserId - The requested user ID from the path parameter
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The user record
 * @throws {forbidden} If user IDs don't match
 * @throws {notFound} If user doesn't exist
 *
 * @example
 * // In a route handler
 * const userRecord = await requireUserAccess(user.id, id);
 *
 * @example
 * // With transaction
 * await prisma.$transaction(async (tx) => {
 *   const userRecord = await requireUserAccess(user.id, id, tx);
 *   // ... other operations within transaction
 * });
 */
export async function requireUserAccess(
  authenticatedUserId: string,
  requestedUserId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  if (authenticatedUserId !== requestedUserId) {
    throw forbidden("You can only access your own user data");
  }

  const user = await tx.user.findUnique({
    where: { id: requestedUserId },
  });

  if (!user) {
    throw notFound("User not found");
  }

  return user;
}

/**
 * Validates access to a task based on user ownership and fetches the task record.
 * Throws 403 if the authenticated user does not have access to the task.
 *
 * @param authContext - The authenticated user context
 * @param taskId - The task ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated task if access is permitted
 * @throws {notFound} If the task does not exist
 * @throws {forbidden} If user does not have access to the task
 *
 * @example
 * const task = await requireUserTaskAccess(authContext, taskId);
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireUserTaskAccess(authContext, taskId, tx);
 *   // ... additional operations
 * });
 */
export async function requireUserTaskAccess(
  authContext: UserAuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await tx.task.findUnique({
    where: {
      id: taskId,
      userId: authContext.userId,
      organizationId: authContext.organizationId,
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

export async function requireAssignableCoworker(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await tx.coworker.findFirst({
    where: {
      id: coworkerId,
      archivedAt: null,
      isWhitelisted: true,
    },
    select: { id: true },
  });

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
  return await requireUserTaskAccess(authContext, taskId, tx);
}

export async function requireScopedTaskReadAccess(
  authContext: AuthenticationContext,
  taskId: string,
  scopes: TaskScope[] | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  if (isCoworkerAuthContext(authContext)) {
    return await requireCoworkerTaskAccess(authContext, taskId, tx);
  }

  const scopeFilters = buildTaskScopeFilters(authContext, scopes);
  if (scopeFilters.length === 0) {
    throw notFound("Task not found");
  }

  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
      OR: scopeFilters,
    },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

export async function requireScopedJobReadAccess(
  authContext: UserAuthenticationContext,
  jobId: string,
  scopes: JobScope[] | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const scopeFilters = buildJobScopeFilters(authContext, scopes);

  if (scopeFilters.length === 0) {
    throw forbidden("You can only access jobs within the requested scope");
  }

  const job = await tx.job.findFirst({
    where: {
      id: jobId,
      OR: scopeFilters,
    },
  });

  if (!job) {
    throw forbidden("You can only access jobs within the requested scope");
  }

  return job;
}
