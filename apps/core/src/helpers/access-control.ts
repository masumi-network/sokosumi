import type { Prisma, User } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { jobRepository, userRepository } from "@sokosumi/database/repositories";
import type { JobWithStatus } from "@sokosumi/database/types/job";

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
): Promise<JobWithStatus> {
  const job = await jobRepository.getJobById(jobId, tx);

  if (!job) {
    throw notFound("Job not found");
  }

  // Check direct ownership
  const hasDirectAccess = job.userId === authContext.userId;

  if (hasDirectAccess) return job;

  // Check organization-level sharing
  const hasOrganizationAccess =
    authContext.organizationId !== null &&
    job.share?.organizationId === authContext.organizationId;

  if (!hasOrganizationAccess) {
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

  const user = await userRepository.getUserById(requestedUserId, tx);

  if (!user) {
    throw notFound("User not found");
  }

  return user;
}
