import type { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import prisma from "@/lib/db/prisma";
import {
  ADMIN_SEO_IMPACT_PAGE_SIZE,
  type AdminSeoActionImpact,
  AUDIT_PAGE_SERIES_KIND,
  type adminSeoActionImpactQuery,
} from "@/schemas/seo-action-impact.schema";
import { getProjectSeoWorkspace } from "./project-seo.service";

const workspace = {
  select: {
    id: true,
    organizationId: true,
    userId: true,
    organization: { select: { slug: true } },
  },
} as const;

/**
 * The before and after of done actions across customers, for staff. Each item
 * is read as the person whose Search Console rows it holds, so staff see what
 * that person sees and nothing that person lost access to.
 */
export async function listAdminSeoActionImpact({
  days,
  page,
}: z.output<typeof adminSeoActionImpactQuery>): Promise<AdminSeoActionImpact> {
  const groups = await prisma.projectSeoObservation.groupBy({
    by: ["auditId", "projectId", "ownerId"],
    where: {
      kind: AUDIT_PAGE_SERIES_KIND,
      visibility: "PRIVATE",
      ownerId: { not: null },
    },
    _max: { observedAt: true },
    orderBy: { _max: { observedAt: "desc" } },
  });
  const items: AdminSeoActionImpact["items"] = [];
  // One owner at a time: each read is a whole SEO workspace.
  for (const { auditId, projectId, ownerId } of groups.slice(
    (page - 1) * ADMIN_SEO_IMPACT_PAGE_SIZE,
    page * ADMIN_SEO_IMPACT_PAGE_SIZE,
  )) {
    const home = auditId
      ? await prisma.seoAudit.findUnique({
          where: { id: auditId },
          select: { workspace },
        })
      : projectId
        ? await prisma.project.findUnique({
            where: { id: projectId },
            select: { workspace },
          })
        : null;
    const owner = auditId
      ? ({ kind: "audit", id: auditId } as const)
      : projectId
        ? ({ kind: "project", id: projectId } as const)
        : null;
    if (!home || !owner || !ownerId) continue;
    const { actions } = await getProjectSeoWorkspace(
      {
        owner,
        workspaceId: home.workspace.id,
        organizationId: home.workspace.organizationId,
        userId: ownerId,
      },
      {},
      { actionImpact: { days } },
    ).catch((error: unknown) => {
      // The person left the workspace, or the audit is archived: they see no impact, so staff see none.
      if (error instanceof HTTPException) return { actions: [] };
      throw error;
    });
    items.push({
      auditId,
      projectId,
      workspaceId: home.workspace.id,
      workspaceOrganizationSlug: home.workspace.organization?.slug ?? null,
      workspaceUserId: home.workspace.userId,
      userId: ownerId,
      actions: actions.flatMap(({ id, pageUrl, title, impact }) =>
        impact ? [{ id, pageUrl, title, impact }] : [],
      ),
    });
  }
  return { total: groups.length, pageSize: ADMIN_SEO_IMPACT_PAGE_SIZE, items };
}
