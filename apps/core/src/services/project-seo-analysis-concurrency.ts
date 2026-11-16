import { type Prisma, TaskStatus } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import { conflict } from "@/helpers/error";
import type { SeoActor } from "@/schemas/project-seo.schema";

export const SEO_INACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
];

/** Called after the owner lock and idempotency lookup, before dispatching a new Task. */
export async function requireNoActiveSeoAnalysis(
  tx: Prisma.TransactionClient,
  actor: Pick<SeoActor, "owner">,
  ignoreTaskId?: string,
): Promise<void> {
  // A row lock alone preserves an older Serializable snapshot. A write makes a stale caller retry after any
  // concurrent dispatch, including the scheduler's Read Committed transaction, before inspecting active Tasks.
  if (actor.owner.kind === "audit")
    await tx.$executeRaw`
      UPDATE "seo_audit" SET "updatedAt" = "updatedAt" WHERE id = ${actor.owner.id}::uuid
    `;
  else
    await tx.$executeRaw`
      UPDATE "project" SET "updatedAt" = "updatedAt" WHERE id = ${actor.owner.id}::uuid
    `;
  const owner =
    actor.owner.kind === "audit"
      ? PrismaRaw.sql`a."auditId" = ${actor.owner.id}::uuid AND a."projectId" IS NULL`
      : PrismaRaw.sql`a."projectId" = ${actor.owner.id}::uuid AND a."auditId" IS NULL`;
  const active = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM "project_seo_analysis" a
    JOIN "task" t ON t.id = a."taskId"
    WHERE ${owner} AND t."archivedAt" IS NULL
      AND t.status::text NOT IN (${PrismaRaw.join(SEO_INACTIVE_TASK_STATUSES)})
      AND ${ignoreTaskId ? PrismaRaw.sql`t.id <> ${ignoreTaskId}` : PrismaRaw.sql`TRUE`}
    LIMIT 1
  `;
  if (active.length)
    throw conflict(
      "This audit already has an active check. Wait for it to finish or cancel its Task before starting another.",
    );
}

/** Restoring or reopening a linked Task must acquire the same Audit slot as a new dispatch. */
export async function requireSeoTaskReactivation(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId },
    select: { auditId: true, projectId: true },
  });
  if (!analysis) return;
  const owner = analysis.auditId
    ? { kind: "audit" as const, id: analysis.auditId }
    : analysis.projectId
      ? { kind: "project" as const, id: analysis.projectId }
      : null;
  if (!owner) throw conflict("The SEO check no longer has an audit");
  await requireNoActiveSeoAnalysis(tx, { owner }, taskId);
}
