import { HTTPException } from "hono/http-exception";

import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  isUserAuthContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

export interface TaskSeoAuditLink {
  auditId: string | null;
  projectId: string | null;
}

/**
 * The SEO audit or Project SEO workspace a Task's analysis belongs to, when the
 * viewer can open that SEO page now: the same check the SEO routes run. Null for
 * another Task, a coworker, a deleted audit, or an owner outside the active workspace.
 */
export async function loadTaskSeoAuditLink(
  vars: {
    authContext: AuthenticationContext;
    workspaceContext: WorkspaceContext | null;
  },
  taskId: string,
): Promise<TaskSeoAuditLink | null> {
  if (!isUserAuthContext(vars.authContext) || !vars.workspaceContext)
    return null;
  const analysis = await prisma.projectSeoAnalysis.findUnique({
    where: { taskId },
    select: { auditId: true, projectId: true },
  });
  if (
    !analysis ||
    (analysis.auditId === null) === (analysis.projectId === null)
  )
    return null;
  // Loaded only for an SEO Task: the SEO store pulls social connection clients.
  const { requireSeoOwner } = await import("@/services/project-seo-store");
  try {
    const owner = await requireSeoOwner(
      requireSeoRouteActor(
        vars,
        analysis.auditId
          ? { kind: "audit", id: analysis.auditId }
          : { kind: "project", id: analysis.projectId! },
      ),
    );
    return { auditId: owner.auditId, projectId: owner.projectId };
  } catch (error) {
    if (
      error instanceof HTTPException &&
      (error.status === 403 || error.status === 404)
    )
      return null;
    throw error;
  }
}
