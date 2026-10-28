import type { MarketingStrategy } from "@sokosumi/database";
import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { parseMarketingPlan } from "@/services/marketing-strategy.service";

/** Any member of the Project's Workspace reads and answers its strategy. */
export async function marketingStrategyScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<{ projectId: string; workspaceId: string; userId: string }> {
  const user = await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) throw notFound("Project not found");
  return { projectId, workspaceId, userId: user.userId };
}

export function mapMarketingStrategy({
  turnId: _turnId,
  plan,
  ...version
}: MarketingStrategy) {
  const parsed = parseMarketingPlan(plan);
  if (!parsed) throw notFound("Marketing strategy version has no valid plan");
  return { ...version, plan: parsed };
}
