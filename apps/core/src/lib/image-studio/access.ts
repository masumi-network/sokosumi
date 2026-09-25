import type { Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * Project access for the image studio, re-derived from the database.
 *
 * The workspace context already scopes a request, but it is resolved from the
 * session's active organization and does not itself prove the caller is still
 * a member of that organization. A session that outlives a removal would keep
 * resolving the same workspace id. Studio calls touch paid generation and
 * private image bytes, so each one re-reads the membership rather than
 * trusting the context it arrived with.
 *
 * Everything here answers 404, never 403: whether a project exists is itself
 * information a non-member should not get.
 */

export interface ProjectAccess {
  projectId: string;
  workspaceId: string;
  userId: string;
}

async function isCurrentMember(
  userId: string,
  workspace: { userId: string | null; organizationId: string | null },
  tx: Prisma.TransactionClient | typeof prisma,
): Promise<boolean> {
  if (workspace.userId) return workspace.userId === userId;
  if (!workspace.organizationId) return false;
  const membership = await tx.member.findFirst({
    where: { userId, organizationId: workspace.organizationId },
    select: { id: true },
  });
  return membership !== null;
}

/**
 * @throws 404 when the project does not exist, sits in another workspace, or
 * the caller is no longer a member of the workspace that owns it.
 */
export async function requireProjectAccess(
  options: {
    projectId: string;
    workspaceId: string;
    userId: string;
  },
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ProjectAccess> {
  const project = await tx.project.findFirst({
    where: { id: options.projectId, workspaceId: options.workspaceId },
    select: {
      id: true,
      workspaceId: true,
      workspace: { select: { userId: true, organizationId: true } },
    },
  });
  if (!project) throw notFound("Project not found");

  if (!(await isCurrentMember(options.userId, project.workspace, tx))) {
    throw notFound("Project not found");
  }

  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId: options.userId,
  };
}

/**
 * The same check without a workspace context to compare against.
 *
 * The agent runtime runs outside Core and names a user and a project; it has
 * no session and therefore no active organization. Resolving the workspace
 * from the project and then proving membership is the whole check, and it is
 * the reason a grant cannot be replayed against a project the user has since
 * lost access to.
 */
export async function requireProjectAccessForUser(
  options: { projectId: string; userId: string },
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ProjectAccess> {
  const project = await tx.project.findUnique({
    where: { id: options.projectId },
    select: {
      id: true,
      workspaceId: true,
      workspace: { select: { userId: true, organizationId: true } },
    },
  });
  if (!project) throw notFound("Project not found");
  if (!(await isCurrentMember(options.userId, project.workspace, tx))) {
    throw notFound("Project not found");
  }
  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId: options.userId,
  };
}
