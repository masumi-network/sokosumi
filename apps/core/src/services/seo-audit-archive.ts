import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import { lockCalendarWorkspaceUserMembership } from "@/helpers/calendar-membership-fence";
import { conflict, notFound } from "@/helpers/error";
import { markTaskArchivedRead } from "@/helpers/task-notifications";
import { retriedTransaction } from "@/lib/db/transaction";
import { SEO_MONITOR_MARKER, seoMonitorAuditId } from "@/lib/seo/monitor-plan";
import { requireNoActiveSeoAnalysis } from "./project-seo-analysis-concurrency";
import {
  requireSeoWorkspace,
  type SeoWorkspaceActor,
} from "./project-seo-store";

import { setSeoAuditTasksArchived } from "./seo-audit-task-archive";

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

async function requireIdleAudit(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  auditId: string,
) {
  await requireNoActiveSeoAnalysis(tx, {
    owner: { kind: "audit", id: auditId },
  });
  const reply = await tx.seoAuditChatTurn.findFirst({
    where: {
      auditId,
      status: "running",
      leaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (reply)
    throw conflict(
      "Wait for the active SEO chat reply before archiving this audit",
      {
        kind: CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHAT,
      },
    );
  if (await hasResumableMonitor(tx, workspaceId, auditId))
    throw conflict("End this audit's scheduled checks before archiving it", {
      kind: CORE_API_ERROR_KINDS.SEO_AUDIT_RESUMABLE_MONITOR,
    });
}

export async function setSeoAuditArchived(
  actor: SeoWorkspaceActor,
  id: string,
  archived: boolean,
) {
  // Read Committed rechecks work admitted by a writer that held the workspace or audit lock first.
  // Keep the audit row for its Task provenance, credit transactions and daily chat allowance.
  const changedTasks = await retriedTransaction(async (tx) => {
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
        deletedAt: null,
        OR: [
          { projectId: null },
          { project: { workspaceId: actor.workspaceId } },
        ],
      },
      select: { archivedAt: true },
    });
    if (!audit) throw notFound("SEO audit not found");
    if (archived === Boolean(audit.archivedAt)) return [];
    if (archived) await requireIdleAudit(tx, actor.workspaceId, id);
    const archiveTime = audit.archivedAt ?? new Date();
    await tx.seoAudit.update({
      where: { id },
      data: { archivedAt: archived ? archiveTime : null },
    });
    return setSeoAuditTasksArchived(tx, actor, id, archived, archiveTime);
  }, "The SEO audit changed. Please retry.");
  if (!changedTasks.length) return;
  await deliverCalendarInvalidationsNow(actor.workspaceId);
  if (archived) await Promise.all(changedTasks.map(markTaskArchivedRead));
}
