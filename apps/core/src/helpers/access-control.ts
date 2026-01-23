import type { Prisma, Task, User } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";

import { forbidden, notFound } from "./error";

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
  authContext: AuthenticationContext,
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
 * Validates task access and fetches the task record
 * Throws 403 if user doesn't have access to the task
 *
 * @param authContext - The authenticated user context
 * @param taskId - The task ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated task with all relations
 * @throws {forbidden} If user doesn't have access to the task

 *
 * @example
 * // In a route handler
 * const task = await requireTaskAccess(authContext, taskId);
 *
 * @example
 * // With transaction
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireTaskAccess(authContext, taskId, tx);
 *   // ... other operations within transaction
 * });
 */
export async function requireTaskAccess(
  authContext: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const task = await tx.task.findUnique({
    where: {
      id: taskId,
      ...(authContext.orchestratorId
        ? { orchestratorId: authContext.orchestratorId }
        : { userId: authContext.userId }),
    },
  });

  if (!task) {
    throw forbidden(
      "You can only access your own tasks or tasks assigned to your orchestrator",
    );
  }

  return task;
}
