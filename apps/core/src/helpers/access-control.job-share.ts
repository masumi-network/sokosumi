import type { Job, Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { isUserAuthContext, requireUserContext } from "@/middleware/auth";

import {
  requireJobCollaboration,
  requireParentTaskNotParked,
} from "./access-control";
import { notFound } from "./error";
import { buildHumanParentTaskVisibilityWhere } from "./task-visibility";

/**
 * Public-share write access for a job: create, update, or revoke the share.
 *
 * A human caller qualifies as the job owner, or as a member of the job's
 * workspace (SOK-1030). The workspace half is what widens sharing beyond the
 * owner, so an organization workspace admits every member of that organization
 * while a personal workspace admits only its owner.
 *
 * Jobs whose parent Task is private follow SOK-1046: only the private Task's
 * human reader (owner) can reach the job for share revoke. Public share
 * create is rejected by PUT /jobs/{id}/share.
 *
 * `workspaceContext` is not client-controlled. It comes from the session's
 * active organization, or, when the session carries none, from an
 * `X-Organization-Slug` header that `organizationHeaderMiddleware` resolves
 * only after `resolveOrganizationFromSlug` confirms the caller's `Member` row.
 * A caller therefore cannot name an organization they do not belong to.
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
 * @throws {notFound} If the caller neither owns the job nor shares its
 *   workspace, or if the job's parent task is missing, archived, or private
 *   to another member
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
      AND: [
        {
          OR: [
            { ownerId: userContext.userId },
            ...(workspaceContext
              ? [{ workspaceId: workspaceContext.workspaceId }]
              : []),
          ],
        },
        {
          OR: [
            { taskId: null },
            {
              task: {
                is: buildHumanParentTaskVisibilityWhere(userContext.userId),
              },
            },
          ],
        },
      ],
    },
  });

  if (!job) {
    throw notFound("Job not found");
  }

  await requireParentTaskNotParked(job, tx);

  return job;
}
