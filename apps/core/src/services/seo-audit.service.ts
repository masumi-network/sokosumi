import type { z } from "@hono/zod-openapi";
import { PrismaRaw } from "@sokosumi/database/client";
import { hasAssignedOrganizationSeat } from "@sokosumi/database/helpers";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { lockCalendarScope } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  createSeoAuditSchema,
  type seoAuditListQuerySchema,
  seoAuditSummarySchema,
  seoAuditWorkspaceMappingSchema,
} from "@/schemas/seo-audit.schema";
import { getProjectSeoWorkspace } from "./project-seo.service";
import {
  normalizeSeoUrl,
  requireSeoWorkspace,
  type SeoWorkspaceActor,
  seoLinkedTaskWhere,
  sha256,
} from "./project-seo-store";
import { requireScopedProject } from "./project-social-connections.service";
import { seoAnalysisStatus } from "./seo-analysis-status";

interface SeoAuditCheckRow {
  auditId: string;
  kind: string;
  status: string;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSeoAudits(
  actor: SeoWorkspaceActor,
  query: Partial<z.infer<typeof seoAuditListQuerySchema>>,
) {
  await requireSeoWorkspace(actor);
  if (query.projectId)
    await requireScopedProject({
      projectId: query.projectId,
      workspaceId: actor.workspaceId,
    });
  const { cursor, take } = parseCursorPagination(query);
  const scope = query.projectId
    ? { workspaceId: actor.workspaceId, projectId: query.projectId }
    : {
        workspaceId: actor.workspaceId,
        OR: [
          { projectId: null },
          { project: { workspaceId: actor.workspaceId } },
        ],
      };
  // A removed last row still marks the next page for readers of this workspace.
  const after = cursor
    ? await prisma.seoAudit.findFirst({
        where: { ...scope, id: cursor },
        select: { id: true, createdAt: true },
      })
    : null;
  if (cursor && !after) throw notFound("SEO audit cursor not found");
  const where = {
    ...scope,
    deletedAt: null,
    archivedAt: query.status === "archived" ? { not: null } : null,
  };
  const [rows, total] = await Promise.all([
    prisma.seoAudit.findMany({
      where: {
        ...where,
        ...(after && {
          AND: {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          },
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: {
        id: true,
        name: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { pages: true } },
      },
    }),
    prisma.seoAudit.count({ where }),
  ]);
  const page = rows.slice(0, take);
  // One indexed row per audit: a nested `take: 1` over several audits reads every check of each.
  const checks = page.length
    ? await prisma.$queryRaw<SeoAuditCheckRow[]>(PrismaRaw.sql`
        SELECT ids.id AS "auditId", c.kind, c.status, c."taskId", c."createdAt", c."updatedAt"
        FROM unnest(${page.map(({ id }) => id)}::uuid[]) AS ids(id)
        CROSS JOIN LATERAL (
          SELECT a.kind, a.status, a."taskId", a."createdAt", a."updatedAt"
          FROM ${sharedTable("project_seo_analysis")} a
          WHERE a."auditId" = ids.id
          ORDER BY a."createdAt" DESC, a.id DESC
          LIMIT 1
        ) c`)
    : [];
  const checkByAudit = new Map(checks.map((check) => [check.auditId, check]));
  const taskIds = checks.flatMap(({ taskId }) => (taskId ? [taskId] : []));
  // The reader sees a Task's status only where the audit page would show that Task.
  const taskStatuses = new Map(
    taskIds.length
      ? (
          await prisma.task.findMany({
            where: { id: { in: taskIds }, ...seoLinkedTaskWhere(actor, true) },
            select: { id: true, status: true },
          })
        ).map((task) => [task.id, task.status])
      : [],
  );
  const audits = page.map(({ _count, ...row }) => {
    const check = checkByAudit.get(row.id);
    return seoAuditSummarySchema.parse({
      ...row,
      pageCount: _count.pages,
      lastCheck: check
        ? {
            kind: check.kind,
            status: seoAnalysisStatus(
              check.status,
              check.taskId ? taskStatuses.get(check.taskId) : undefined,
            ),
            createdAt: check.createdAt,
            updatedAt: check.updatedAt,
          }
        : null,
    });
  });
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
      deletedAt: null,
      archivedAt: null,
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
  const { idempotencyKey, ...input } = createSeoAuditSchema.parse(raw);
  const requestHash = idempotencyKey ? sha256(JSON.stringify(input)) : null;
  const audit = await serializableTransaction(async (tx) => {
    // The key check comes before the Project: a reused key answers 409 for
    // any changed input, also a Project that does not exist.
    if (!(await lockCalendarScope(tx, actor.workspaceId, [], actor.userId)))
      throw notFound("SEO workspace not found");
    await requireSeoWorkspace(actor, tx);
    if (idempotencyKey) {
      const previous = await tx.seoAudit.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: actor.workspaceId,
            idempotencyKey,
          },
        },
      });
      if (previous) {
        if (
          previous.requestHash !== requestHash ||
          previous.createdById !== actor.userId
        )
          throw conflict("This audit key was already used for another request");
        return previous;
      }
    }
    // Only a fresh create needs an open Project: a replay returns the Audit
    // the first create made, also after its Project closed.
    if (input.projectId) {
      if (!(await lockCalendarScope(tx, actor.workspaceId, [input.projectId])))
        throw notFound("SEO workspace or linked Project not found");
      await requireScopedProject(
        { projectId: input.projectId, workspaceId: actor.workspaceId },
        { client: tx, requireOpen: true },
      );
    }
    return tx.seoAudit.create({
      data: {
        workspaceId: actor.workspaceId,
        projectId: input.projectId ?? null,
        name: input.name,
        createdById: actor.userId,
        idempotencyKey: idempotencyKey ?? null,
        requestHash,
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
