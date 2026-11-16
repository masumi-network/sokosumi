import type { Prisma } from "@sokosumi/database";

import { conflict, forbidden } from "@/helpers/error";
import { SEO_MONITOR_MARKER } from "@/lib/seo/monitor-plan";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { requireSeoOwner } from "./project-seo-store";

/** Internal ledger identity. It never comes from an analysis request body. */
export interface PlannedSeoMonitorRun {
  scheduleId: string;
  runId: string;
}

/** Called under the owner locks, before dispatch, balance and concurrency checks. */
export async function requirePlannedSeoMonitorRun(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  context: PlannedSeoMonitorRun,
): Promise<void> {
  const owner = await requireSeoOwner(actor, tx);
  const run = await tx.taskScheduleRun.findFirst({
    where: {
      id: context.runId,
      scheduleId: context.scheduleId,
      state: "PLANNED",
      manual: false,
      sourceWorkspaceId: actor.workspaceId,
      sourceProjectId: owner.projectId,
      schedule: {
        workspaceId: actor.workspaceId,
        projectId: owner.projectId,
        ownerId: actor.userId,
        state: "ACTIVE",
        visibility: "PUBLIC",
        description: { startsWith: SEO_MONITOR_MARKER },
      },
    },
    select: { effectiveScheduledAt: true },
  });
  if (!run)
    throw forbidden("The approved SEO monitor Run is no longer planned");
  if (!owner.closingAt && !owner.closedAt) return;

  const close = owner.projectId
    ? await tx.projectCloseOperation.findUnique({
        where: { projectId: owner.projectId },
        select: { state: true, cutoffAt: true },
      })
    : null;
  if (
    owner.closedAt ||
    !owner.closingAt ||
    close?.state !== "CLOSING" ||
    close.cutoffAt.getTime() !== owner.closingAt.getTime() ||
    run.effectiveScheduledAt >= close.cutoffAt
  )
    throw conflict(
      "Only an SEO monitor Run owed before Project close may start",
    );
}
