import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import { createNotification } from "@/helpers/notifications";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { isSeoMonitorDescription } from "@/lib/seo/monitor-plan";

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
      schedule: { select: { ownerId: true, description: true } },
    },
  });
  const ownerId = task?.schedule?.ownerId;
  if (
    !task?.scheduleId ||
    !ownerId ||
    !isSeoMonitorDescription(task.schedule?.description ?? null)
  )
    return;
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
      // A late result compares against the Runs before its own, not against newer ones.
      createdAt: { lt: task.createdAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SEO_MONITOR_EARLIER_RUNS,
    select: { id: true },
  });
  const [previous] = await newestSeoMonitorResults(
    earlier.map((item) => item.id),
    row.observedAt,
  );
  if (!previous) return;
  const change = compareSeoMonitorRuns(previous, {
    observedAt: row.observedAt,
    payload: payload.data,
  });
  if (!isSeoMonitorChangeWorse(change)) return;
  await createNotification({
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
