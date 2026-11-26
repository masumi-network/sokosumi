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

/** How many SEO workspaces one staff request builds at the same time. */
const ADMIN_IMPACT_READS_AT_ONCE = 5;

async function readItem(
  {
    auditId,
    projectId,
    ownerId,
  }: {
    auditId: string | null;
    projectId: string | null;
    ownerId: string | null;
  },
  days: number | undefined,
): Promise<AdminSeoActionImpact["items"]> {
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
  if (!home || !owner || !ownerId) return [];
  const { actions } = await getProjectSeoWorkspace(
    {
      owner,
      workspaceId: home.workspace.id,
      organizationId: home.workspace.organizationId,
      userId: ownerId,
    },
    {},
    { actionImpact: { days, ownerId } },
  ).catch((error: unknown) => {
    // The person left the workspace, or the audit is archived: they see no impact, so staff see none.
    if (error instanceof HTTPException) return { actions: [] };
    throw error;
  });
  return [
    {
      auditId,
      projectId,
      workspaceId: home.workspace.id,
      workspaceOrganizationSlug: home.workspace.organization?.slug ?? null,
      workspaceUserId: home.workspace.userId,
      userId: ownerId,
      actions: actions.flatMap(({ id, pageUrl, title, impact }) =>
        impact ? [{ id, pageUrl, title, impact }] : [],
      ),
    },
  ];
}

/**
 * The before and after of done actions across customers, for staff. Each item
 * is read as the person whose Search Console rows it holds, so staff see what
 * that person sees and nothing that person lost access to. Only that person's
 * own rows count, so two people of one SEO collection do not show each other's numbers.
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
  const shown = groups.slice(
    (page - 1) * ADMIN_SEO_IMPACT_PAGE_SIZE,
    page * ADMIN_SEO_IMPACT_PAGE_SIZE,
  );
  const items: AdminSeoActionImpact["items"] = [];
  // Each read is a whole SEO workspace, so a few run at a time, not the whole page at once.
  for (let at = 0; at < shown.length; at += ADMIN_IMPACT_READS_AT_ONCE)
    items.push(
      ...(
        await Promise.all(
          shown
            .slice(at, at + ADMIN_IMPACT_READS_AT_ONCE)
            .map((group) => readItem(group, days)),
        )
      ).flat(),
    );
  return { total: groups.length, pageSize: ADMIN_SEO_IMPACT_PAGE_SIZE, items };
}
