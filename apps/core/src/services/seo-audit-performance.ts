import type { Prisma } from "@sokosumi/database";
import { conflict, notFound } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import { searchConsoleSettledEnd } from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import { syncProjectSeoStatistics } from "./project-seo-statistics.service";
import { requireLockedSeoOwner } from "./project-seo-store";
import { assertAuditSearchConsoleCurrent } from "./seo-audit-search-console";
import { readApprovedSeoTaskPages } from "./seo-task-audit-context";

const AUDIT_PERFORMANCE_DAYS = 90;
export function auditSearchConsolePeriod(createdAt: Date) {
  const to = searchConsoleSettledEnd(
    createdAt.toISOString().slice(0, 10),
    "",
    createdAt,
  );
  const start = new Date(to);
  start.setUTCDate(start.getUTCDate() - AUDIT_PERFORMANCE_DAYS + 1);
  return { from: start.toISOString().slice(0, 10), to };
}

export async function readAuditSearchConsoleBinding(
  tx: Prisma.TransactionClient,
  taskId: string,
  requester?: SeoActor,
) {
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId },
  });
  if (!analysis || analysis.kind !== "audit_full") return null;
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      ownerId: true,
      workspaceId: true,
      organizationId: true,
      projectId: true,
    },
  });
  if (
    !task ||
    !["RUNNING", "COMPLETED"].includes(task.status) ||
    task.ownerId !== analysis.requestedBy ||
    (analysis.auditId === null) === (analysis.projectId === null)
  )
    return null;
  const actor: SeoActor = {
    owner: analysis.auditId
      ? { kind: "audit", id: analysis.auditId }
      : { kind: "project", id: analysis.projectId! },
    workspaceId: task.workspaceId,
    organizationId: task.organizationId,
    userId: analysis.requestedBy,
  };
  if (
    requester &&
    (requester.sokoBotId ||
      task.status !== "COMPLETED" ||
      requester.userId !== actor.userId ||
      requester.workspaceId !== actor.workspaceId ||
      requester.organizationId !== actor.organizationId ||
      requester.owner.kind !== actor.owner.kind ||
      requester.owner.id !== actor.owner.id)
  )
    return null;
  const access = storedSeoAuditSearchConsoleSchema.parse(
    analysis.request,
  ).searchConsoleAccess;
  if (!access) return null;
  const owner = await requireLockedSeoOwner(tx, actor);
  if (owner.projectId !== task.projectId) return null;
  const { pages } = await readApprovedSeoTaskPages(tx, actor, analysis);
  await assertAuditSearchConsoleCurrent(actor, access, tx);
  return {
    actor,
    access,
    pages,
    period: auditSearchConsolePeriod(analysis.createdAt),
  };
}

/** Capture the approved pages once per audit. The worker never receives the connection or the result. */
export async function collectSeoAuditPerformance(
  taskId: string,
  requester?: SeoActor,
) {
  const binding = await serializableTransaction(
    (tx) => readAuditSearchConsoleBinding(tx, taskId, requester),
    "The audit changed during collection.",
  );
  if (!binding) {
    if (requester) throw notFound("The approved audit is unavailable.");
    return;
  }
  const { actor, access, pages, period } = binding;
  await syncProjectSeoStatistics(
    actor,
    {
      provider: "search_console",
      propertyId: access.propertyId,
      pageIds: pages.map((page) => page.id),
      ...period,
      channel: "organic",
      searchType: "web",
      automatic: true,
    },
    {
      authorize: async (tx) => {
        const current = await readAuditSearchConsoleBinding(
          tx,
          taskId,
          requester,
        );
        if (JSON.stringify(current) !== JSON.stringify(binding))
          throw conflict(
            "The approved audit changed during statistics collection.",
          );
      },
    },
    {
      taskId,
      connectionVersion: access.connectionVersion,
      ...(access.includeSitemaps && { includeSitemaps: true }),
      pageUrls: pages.map((page) => page.url),
    },
  );
  return pages.map((page) => page.id);
}
