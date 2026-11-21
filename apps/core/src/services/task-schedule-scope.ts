import type { Prisma } from "@sokosumi/database";
import {
  lockCalendarScope,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";
import { notFound } from "@/helpers/error";
import { seoMonitorAuditId } from "@/lib/seo/monitor-plan";
import { requireLockedSeoOwner } from "./project-seo-store";
import type { ScheduleActor } from "./task-schedule-read.service";

/**
 * A closing project Ends its schedules and a closed one never releases, so a
 * schedule neither joins nor changes in one. The scope is locked first, as the
 * close request locks it, so a close cannot slip in between.
 */
export async function requireOpenScheduleProjects(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [
    ...new Set(projectIds.filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return;
  if (!(await lockCalendarScope(tx, workspaceId, ids))) {
    throw notFound("Project not found");
  }
  for (const id of ids) {
    await requireOpenCalendarProject(tx, workspaceId, id);
  }
}

/** Lock the audit before changing a schedule that can still run. Deletion checks schedules under the same lock. */
export async function lockScheduleMonitorAudit(
  tx: Prisma.TransactionClient,
  actor: ScheduleActor,
  description: string | null | undefined,
) {
  const id = seoMonitorAuditId(description ?? null);
  if (id) {
    await requireLockedSeoOwner(
      tx,
      {
        owner: { kind: "audit", id },
        userId: actor.userId,
        workspaceId: actor.workspace.workspaceId,
        organizationId: actor.workspace.organizationId,
      },
      false,
    );
  }
}
