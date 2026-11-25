import type { z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { hasAdminRole, SEO_ADMIN_CRITICAL_MESSAGE_KEY } from "@sokosumi/utils";
import {
  type CreateNotificationInput,
  createNotification,
} from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import type { adminSeoAlerts } from "@/schemas/admin-seo-alerts.schema";

import { listAdminSeoAlerts } from "./admin-seo-alerts";

/** The admin list's shortest period. An open alert is in it at any age. */
const ADMIN_SEO_ALERT_PERIOD = "7";

type AdminSeoAlert = z.output<typeof adminSeoAlerts>["items"][number];

/**
 * One notification for each critical alert and platform admin that has none yet. The alert's Task keys it, so the
 * same failed Run notifies once however often the sync reads it; an alert without a Task is keyed by its own id.
 */
export function adminSeoAlertNotifications(
  alerts: Pick<AdminSeoAlert, "id" | "taskId" | "severity">[],
  users: { id: string; role: string | null }[],
  sent: { userId: string; referenceId: string }[],
): CreateNotificationInput[] {
  const done = new Set(sent.map((row) => `${row.userId}|${row.referenceId}`));
  const references = new Set(
    alerts
      .filter((alert) => alert.severity === "critical")
      .map((alert) => alert.taskId ?? alert.id),
  );
  return users
    .filter((user) => hasAdminRole(user.role))
    .flatMap((user) =>
      [...references]
        .filter((referenceId) => !done.has(`${user.id}|${referenceId}`))
        .map((referenceId) => ({
          userId: user.id,
          kind: NotificationKind.SYSTEM,
          referenceId,
          eventId: referenceId,
          messageKey: SEO_ADMIN_CRITICAL_MESSAGE_KEY,
          messageParams: {},
        })),
    );
}

/**
 * Tells every platform admin about a critical SEO alert, in the app. `critical` is the count of the whole list and
 * `read` the critical alerts on its first page: a larger `critical` means alerts this run did not reach.
 */
export async function notifyAdminSeoAlerts() {
  const { critical, items } = await listAdminSeoAlerts({
    period: ADMIN_SEO_ALERT_PERIOD,
    page: 1,
  });
  const alerts = items.filter((alert) => alert.severity === "critical");
  if (!alerts.length) return { critical, read: 0, sent: 0 };
  const users = await prisma.user.findMany({
    // The role is a comma-separated list: this narrows the read, hasAdminRole decides.
    where: { role: { contains: "admin" }, NOT: { banned: true } },
    select: { id: true, role: true },
  });
  const sent = await prisma.notification.findMany({
    where: {
      kind: NotificationKind.SYSTEM,
      messageKey: SEO_ADMIN_CRITICAL_MESSAGE_KEY,
      userId: { in: users.map((user) => user.id) },
      referenceId: { in: alerts.map((alert) => alert.taskId ?? alert.id) },
    },
    select: { userId: true, referenceId: true },
  });
  const inputs = adminSeoAlertNotifications(alerts, users, sent);
  // A row another run wrote in between is a no-op in createNotification.
  for (const input of inputs) await createNotification(input);
  return { critical, read: alerts.length, sent: inputs.length };
}
