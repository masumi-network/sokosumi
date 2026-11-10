import type { z } from "@hono/zod-openapi";
import { hasAssignedOrganizationSeat } from "@sokosumi/database/helpers";

import { lockCalendarScope } from "@/helpers/calendar-locks";
import { notFound } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  createSeoAuditSchema,
  seoAuditSummarySchema,
  seoAuditWorkspaceMappingSchema,
} from "@/schemas/seo-audit.schema";
import { getProjectSeoWorkspace } from "./project-seo.service";
import {
  normalizeSeoUrl,
  requireSeoWorkspace,
  type SeoWorkspaceActor,
} from "./project-seo-store";
import { requireScopedProject } from "./project-social-connections.service";

export async function listSeoAudits(
  actor: SeoWorkspaceActor,
  query: { cursor?: string; limit?: number; projectId?: string },
) {
  await requireSeoWorkspace(actor);
  if (query.projectId)
    await requireScopedProject({
      projectId: query.projectId,
      workspaceId: actor.workspaceId,
    });
  const { cursor, take, skip } = parseCursorPagination(query);
  const where = query.projectId
    ? { workspaceId: actor.workspaceId, projectId: query.projectId }
    : {
        workspaceId: actor.workspaceId,
        OR: [
          { projectId: null },
          { project: { workspaceId: actor.workspaceId } },
        ],
      };
  if (
    cursor &&
    !(await prisma.seoAudit.findFirst({
      where: { ...where, id: cursor },
      select: { id: true },
    }))
  )
    throw notFound("SEO audit cursor not found");
  const [rows, total] = await Promise.all([
    prisma.seoAudit.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      include: { _count: { select: { pages: true } } },
    }),
    prisma.seoAudit.count({ where }),
  ]);
  const audits = rows
    .slice(0, take)
    .map((row) =>
      seoAuditSummarySchema.parse({ ...row, pageCount: row._count.pages }),
    );
  return {
    audits,
    pagination: createPaginationMeta(
      audits,
      total,
      take,
      rows.length > take,
      cursor,
    ),
  };
}

/**
 * Maps an Audit id to its workspace, for a link opened in another workspace.
 *
 * Answers only for a reader who can open the Audit after a switch: the owner
 * of its personal workspace, or a member of its organization with a seat.
 * Every other case is the 404 of an id that does not exist, so the answer
 * does not tell a stranger that an Audit is there.
 */
export async function getSeoAuditWorkspaceMapping(
  userId: string,
  auditId: string,
) {
  const audit = await prisma.seoAudit.findFirst({
    where: {
      id: auditId,
      workspace: {
        OR: [{ userId }, { organization: { members: { some: { userId } } } }],
      },
    },
    select: {
      name: true,
      workspaceId: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (
    !audit ||
    !(await hasAssignedOrganizationSeat(
      userId,
      audit.workspace.organizationId,
      prisma,
    ))
  )
    throw notFound("SEO audit not found");
  return seoAuditWorkspaceMappingSchema.parse({
    name: audit.name,
    workspaceId: audit.workspaceId,
    organizationId: audit.workspace.organizationId,
  });
}

/** An Audit and its first page either both exist, or neither is retained. */
export async function createSeoAudit(
  actor: SeoWorkspaceActor,
  raw: z.infer<typeof createSeoAuditSchema>,
) {
  const input = createSeoAuditSchema.parse(raw);
  const audit = await serializableTransaction(async (tx) => {
    if (
      !(await lockCalendarScope(
        tx,
        actor.workspaceId,
        input.projectId ? [input.projectId] : [],
        actor.userId,
      ))
    )
      throw notFound("SEO workspace or linked Project not found");
    await requireSeoWorkspace(actor, tx);
    if (input.projectId)
      await requireScopedProject(
        { projectId: input.projectId, workspaceId: actor.workspaceId },
        { client: tx, requireOpen: true },
      );
    return tx.seoAudit.create({
      data: {
        workspaceId: actor.workspaceId,
        projectId: input.projectId ?? null,
        name: input.name,
        createdById: actor.userId,
        pages: {
          create: {
            url: normalizeSeoUrl(input.firstPage.url),
            label: input.firstPage.label ?? "",
            relationship: input.firstPage.relationship,
          },
        },
      },
    });
  }, "The SEO workspace changed. Please retry.");
  return getProjectSeoWorkspace({
    ...actor,
    owner: { kind: "audit", id: audit.id },
  });
}
