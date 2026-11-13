import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
import { createNotification } from "@/helpers/notifications";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import {
  parseSeoMonitorPlan,
  type SeoMonitorPlan,
} from "@/lib/seo/monitor-plan";
import type { SeoActor } from "@/schemas/project-seo.schema";

import {
  compareSeoMonitorRuns,
  isSeoMonitorChangeWorse,
} from "./project-seo-monitor-change";
import { newestSeoMonitorResults } from "./project-seo-monitor-runs";

export const SEO_MONITOR_WORSE_MESSAGE_KEY =
  "Notifications.Task.seoMonitorWorse";
/** Tasks before this one searched for the result to compare against. */
const SEO_MONITOR_EARLIER_RUNS = 10;

/**
 * Tells the monitor's Owner when its new result is worse than the result before: a check that passed fails, or a
 * ranked keyword fell beyond the noise band. In-app, and by email through the task update path. Nothing when it
 * stayed the same or got better. The observation id keys the notification, so a repeated import sends one.
 */
export async function notifySeoMonitorWorse(
  taskId: string,
  observationId: string,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      name: true,
      createdAt: true,
      workspaceId: true,
      scheduleId: true,
      schedule: {
        select: { ownerId: true, description: true, projectId: true },
      },
    },
  });
  const ownerId = task?.schedule?.ownerId;
  if (!task?.scheduleId || !ownerId) return;
  let plan: SeoMonitorPlan | null;
  try {
    plan = parseSeoMonitorPlan(task.schedule?.description ?? null);
  } catch {
    return;
  }
  const projectId = task.schedule?.projectId;
  if (!plan || (plan.version === 1 && !projectId)) return;
  const owner: Pick<SeoActor, "owner"> = {
    owner:
      plan.version === 2
        ? { kind: "audit", id: plan.auditId }
        : { kind: "project", id: projectId! },
  };
  const row = await prisma.projectSeoObservation.findUnique({
    where: { id: observationId },
    select: { observedAt: true, payload: true },
  });
  const payload = publicSeoPayloadSchema.safeParse(row?.payload);
  if (!row || !payload.success) return;
  const earlier = await prisma.task.findMany({
    where: {
      scheduleId: task.scheduleId,
      workspaceId: task.workspaceId,
      id: { not: taskId },
      // A late result compares against the Runs before its own, in the workspace order (created time, then id).
      OR: [
        { createdAt: { lt: task.createdAt } },
        { createdAt: task.createdAt, id: { lt: taskId } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SEO_MONITOR_EARLIER_RUNS,
    select: { id: true },
  });
  const [previous] = await newestSeoMonitorResults(
    owner,
    earlier.map((item) => item.id),
  );
  if (!previous) return;
  const change = compareSeoMonitorRuns(previous, {
    observedAt: row.observedAt,
    payload: payload.data,
  });
  if (!isSeoMonitorChangeWorse(change)) return;
  // Under the membership lock: an Owner removed from the Workspace gets no notification.
  await prisma.$transaction(async (tx) => {
    await lockCalendarWorkspaceMembership(tx, task.workspaceId);
    if (!(await hasCalendarWorkspaceAccess(tx, task.workspaceId, ownerId))) {
      return;
    }
    await createNotification(
      {
        userId: ownerId,
        workspaceId: task.workspaceId,
        kind: NotificationKind.TASK,
        referenceId: taskId,
        eventId: observationId,
        messageKey: SEO_MONITOR_WORSE_MESSAGE_KEY,
        messageParams: {
          taskName: task.name,
          newFailures: change.newFailureCount,
          drops: change.dropCount,
        },
      },
      tx,
    );
  });
}

/** After the import committed. A failed notification never fails the import. */
export async function notifySeoMonitorWorseSafely(
  taskId: string,
  observationId: string,
): Promise<void> {
  try {
    await notifySeoMonitorWorse(taskId, observationId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: "seo-monitor-notify" },
      extra: { taskId, observationId },
    });
  }
}
