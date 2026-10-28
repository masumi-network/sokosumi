import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";

/** Any member of the Project's Workspace reads, edits and confirms its Brand Brain. */
export async function brandBrainScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<{ projectId: string; userId: string }> {
  const { userId } = await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) throw notFound("Project not found");
  return { projectId, userId };
}
