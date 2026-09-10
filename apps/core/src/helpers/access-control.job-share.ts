import type { Job, Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { isUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

import {
  requireJobCollaboration,
  requireJobRead,
  requireParentTaskNotParked,
} from "./access-control";

/**
 * Public-share write access for a job: create, update, or revoke the share.
 *
 * Any human member of the job's workspace may share, not only the job owner
 * (SOK-1030). The workspace is the permission boundary: `workspaceContext` is
 * resolved server-side from the session's active organization, never from a
 * client header, so an organization workspace admits every member of that
 * organization while a personal workspace admits only its owner.
 *
 * Deliberately separate from {@link requireJobCollaboration}, which also guards
 * refund, workspace move, metadata patch, and input submission. Widening that
 * helper would widen those routes too.
 *
 * Soko Bot and coworker contexts keep their existing collaboration rules
 * unchanged; this only widens human access.
 *
 * @throws {notFound} If the job is not in the caller's active workspace
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

  const job = await requireJobRead(
    requireWorkspaceContext(workspaceContext),
    jobId,
    tx,
  );
  await requireParentTaskNotParked(job, tx);

  return job;
}
