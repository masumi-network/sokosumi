import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma } from "@sokosumi/database";
import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
import { createNotification, resolveDelivery } from "@/helpers/notifications";
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
 * The monitor Run behind a Task: its Workspace, the schedule Owner and the SEO collection the monitor reads. Null when
 * the Task is no monitor Run.
 */
export async function seoMonitorRunOf(taskId: string) {
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
  if (!task?.scheduleId || !ownerId) return null;
  let plan: SeoMonitorPlan | null;
  try {
    plan = parseSeoMonitorPlan(task.schedule?.description ?? null);
  } catch {
    return null;
  }
  const projectId = task.schedule?.projectId;
  if (!plan || (plan.version === 1 && !projectId)) return null;
  const owner: Pick<SeoActor, "owner"> = {
    owner:
      plan.version === 2
        ? { kind: "audit", id: plan.auditId }
        : { kind: "project", id: projectId! },
  };
  return { ...task, scheduleId: task.scheduleId, ownerId, owner };
}

/**
 * Tells the monitor's Owner when its new result is worse than the result before: a check that passed fails, or a
 * ranked keyword fell beyond the noise band. In-app, and by email through the task update path. Nothing when it
 * stayed the same or got better. The Run (its Task) keys the notification, so a repeated import or a second file of
 * the same Run sends no second one.
 */
export async function notifySeoMonitorWorse(
  taskId: string,
  observationId: string,
): Promise<void> {
  const task = await seoMonitorRunOf(taskId);
  if (!task) return;
  const { ownerId, owner } = task;
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
  await sendSeoMonitorNotification(owner, {
    userId: ownerId,
    workspaceId: task.workspaceId,
    kind: NotificationKind.TASK,
    referenceId: taskId,
    eventId: taskId,
    messageKey: SEO_MONITOR_WORSE_MESSAGE_KEY,
    messageParams: {
      taskName: task.name,
      site: new URL(payload.data.pageUrls[0]).hostname,
      newFailures: change.newFailureCount,
      drops: change.dropCount,
      lostCitations: change.lostCitationCount,
    },
  });
}

type SeoMonitorNotification = Parameters<typeof createNotification>[0] & {
  workspaceId: string;
};

/**
 * One notification per event of a monitor. `same` names the rows that stand for the same event; by default the Run
 * (its Task) keys it, so a second file of the Run sends no second one.
 */
export async function sendSeoMonitorNotification(
  { owner }: Pick<SeoActor, "owner">,
  input: SeoMonitorNotification,
  same: Prisma.NotificationWhereInput = { referenceId: input.referenceId },
): Promise<void> {
  const { userId, workspaceId } = input;
  // Inside the transaction the unique key error would abort it, so the row is looked for first.
  const sent = (client: Pick<typeof prisma, "notification">) =>
    client.notification.findFirst({
      where: {
        userId,
        kind: input.kind,
        eventId: input.eventId,
        messageKey: input.messageKey,
        ...same,
      },
      select: { id: true },
    });
  if (await sent(prisma)) return;
  // Read before the lock, so the transaction holds the membership lock only for the check and the write.
  const delivery = await resolveDelivery(input);
  // Under the membership lock: an Owner removed from the Workspace gets no notification. createNotification checks
  // again in the same transaction but throws; this check returns quietly.
  await prisma.$transaction(async (tx) => {
    await lockCalendarWorkspaceMembership(tx, workspaceId);
    // Two imports notify at the same time: the second waits on the lock and then finds the first one's row.
    if (
      !(await hasCalendarWorkspaceAccess(tx, workspaceId, userId)) ||
      (owner.kind === "audit" &&
        !(await tx.seoAudit.findFirst({
          where: {
            id: owner.id,
            workspaceId,
            deletedAt: null,
            archivedAt: null,
          },
          select: { id: true },
        }))) ||
      (await sent(tx))
    ) {
      return;
    }
    await createNotification(input, tx, delivery);
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
