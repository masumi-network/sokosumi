import type { Job, Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { isUserAuthContext, requireUserContext } from "@/middleware/auth";

import {
  requireJobCollaboration,
  requireParentTaskNotParked,
} from "./access-control";
import { notFound } from "./error";

/**
 * Public-share write access for a job: create, update, or revoke the share.
 *
 * A human caller qualifies as the job owner, or as a member of the job's
 * workspace (SOK-1030). The workspace half is what widens sharing beyond the
 * owner: `workspaceContext` is resolved server-side from the session's active
 * organization, never from a client header, so an organization workspace admits
 * every member of that organization while a personal workspace admits only its
 * owner.
 *
 * Ownership stays in the predicate because API key and OAuth callers carry no
 * active organization (`organizationId: null` in their auth context), so their
 * workspace resolves to the personal one. Dropping ownership would stop them
 * sharing their own organization jobs.
 *
 * Deliberately separate from {@link requireJobCollaboration}, which also guards
 * refund, workspace move, metadata patch, and input submission. Widening that
 * helper would widen those routes too.
 *
 * Soko Bot and coworker contexts keep their existing collaboration rules
 * unchanged; this only widens human access.
 *
 * @throws {notFound} If the caller neither owns the job nor shares its workspace
 * @throws {forbidden} If the parent task is parked, or the agent context is not
 *   permitted to act on the job
 */
export async function requireJobShareCollaboration(
  vars: EnvVariables["Variables"],
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const { authContext, workspaceContext } = vars;

  if (!isUserAuthContext(authContext)) {
    return await requireJobCollaboration(authContext, jobId, tx);
  }

  const userContext = requireUserContext(authContext);

  const job = await tx.job.findFirst({
    where: {
      id: jobId,
      OR: [
        { ownerId: userContext.userId },
        ...(workspaceContext
          ? [{ workspaceId: workspaceContext.workspaceId }]
          : []),
      ],
    },
  });

  if (!job) {
    throw notFound("Job not found");
  }

  await requireParentTaskNotParked(job, tx);

  return job;
}
