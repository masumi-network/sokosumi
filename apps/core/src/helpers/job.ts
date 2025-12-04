import type { Prisma } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { jobRepository } from "@sokosumi/database/repositories";
import type { JobWithStatus } from "@sokosumi/database/types/job";

import { forbidden, notFound } from "./error";

/**
 * Validates job ownership and returns the job if valid
 * Throws 404 if job doesn't exist, 403 if user doesn't own it
 *
 * @param userId - The user ID to check ownership against
 * @param jobId - The job ID to fetch and validate
 * @param prisma - Optional Prisma client for transaction support
 * @returns The validated job with all relations
 * @throws {notFound} If job doesn't exist
 * @throws {forbidden} If user doesn't own the job
 *
 * @example
 * // In a route handler
 * const job = await requireJobOwnership(user.id, jobId);
 *
 * @example
 * // With transaction
 * await prisma.$transaction(async (tx) => {
 *   const job = await requireJobOwnership(user.id, jobId, tx);
 *   // ... other operations within transaction
 * });
 */
export async function requireJobOwnership(
  userId: string,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus> {
  const job = await jobRepository.getJobById(jobId, tx);

  if (!job) {
    throw notFound("Job not found");
  }

  if (job.userId !== userId) {
    throw forbidden("You can only access your own jobs");
  }

  return job;
}
