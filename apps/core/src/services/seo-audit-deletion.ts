import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import { lockCalendarWorkspaceUserMembership } from "@/helpers/calendar-membership-fence";
import { conflict, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { SEO_MONITOR_MARKER, seoMonitorAuditId } from "@/lib/seo/monitor-plan";
import { requireNoActiveSeoAnalysis } from "./project-seo-analysis-concurrency";
import {
  requireSeoWorkspace,
  type SeoWorkspaceActor,
} from "./project-seo-store";

const MONITOR_BATCH = 100;

async function hasResumableMonitor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  auditId: string,
) {
  let after: string | undefined;
  for (;;) {
    const rows: { id: string; description: string | null }[] =
      await tx.taskSchedule.findMany({
        where: {
          workspaceId,
          state: { not: "ENDED" },
          description: { startsWith: SEO_MONITOR_MARKER },
          ...(after && { id: { gt: after } }),
        },
        select: { id: true, description: true },
        orderBy: { id: "asc" },
        take: MONITOR_BATCH,
      });
    if (rows.some((row) => seoMonitorAuditId(row.description) === auditId))
      return true;
    if (rows.length < MONITOR_BATCH) return false;
    after = rows[rows.length - 1].id;
  }
}

export async function deleteSeoAudit(actor: SeoWorkspaceActor, id: string) {
  // Read Committed rechecks work admitted by a writer that held the workspace or audit lock first.
  // Keep the audit row for its Task provenance, credit transactions and daily chat allowance.
  await prisma.$transaction(async (tx) => {
    await lockCalendarWorkspaceUserMembership(
      tx,
      actor.workspaceId,
      actor.userId,
    );
    if (!(await lockCalendarScope(tx, actor.workspaceId, [], actor.userId)))
      throw notFound("SEO workspace not found");
    await requireSeoWorkspace(actor, tx);
    const audit = await tx.seoAudit.findFirst({
      where: {
        id,
        workspaceId: actor.workspaceId,
        OR: [
          { projectId: null },
          { project: { workspaceId: actor.workspaceId } },
        ],
      },
      select: { id: true, createdById: true, deletedAt: true },
    });
    if (!audit || (audit.deletedAt && audit.createdById !== actor.userId))
      throw notFound("SEO audit not found");
    if (audit.createdById !== actor.userId)
      throw forbidden("Only the creator can delete this SEO audit");
    if (audit.deletedAt) return;
    await requireNoActiveSeoAnalysis(tx, {
      owner: { kind: "audit", id: audit.id },
    });
    const reply = await tx.seoAuditChatTurn.findFirst({
      where: {
        auditId: audit.id,
        status: "running",
        leaseExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (reply)
      throw conflict(
        "Wait for the active SEO chat reply before deleting this audit",
        { kind: CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHAT },
      );
    if (await hasResumableMonitor(tx, actor.workspaceId, audit.id))
      throw conflict("End this audit's scheduled checks before deleting it", {
        kind: CORE_API_ERROR_KINDS.SEO_AUDIT_RESUMABLE_MONITOR,
      });
    await tx.seoAudit.update({
      where: { id: audit.id },
      data: { deletedAt: new Date() },
    });
  });
}
