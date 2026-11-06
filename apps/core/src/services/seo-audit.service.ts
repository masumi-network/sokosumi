import type { z } from "@hono/zod-openapi";

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
  query: { cursor?: string; limit?: number },
) {
  await requireSeoWorkspace(actor);
  const { cursor, take, skip } = parseCursorPagination(query);
  const where = {
    workspaceId: actor.workspaceId,
    OR: [{ projectId: null }, { project: { workspaceId: actor.workspaceId } }],
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
