import type { z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { hasAdminRole, SEO_ADMIN_CRITICAL_MESSAGE_KEY } from "@sokosumi/utils";
import {
  type CreateNotificationInput,
  createNotification,
} from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import {
  type adminSeoAlerts,
  SEO_ALERTS_PAGE_SIZE,
} from "@/schemas/admin-seo-alerts.schema";

import { listAdminSeoAlerts } from "./admin-seo-alerts";

/** The shortest period the list accepts (7, 30, 90, all). An open alert is in it at any age. */
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

/** A full page of critical alerts is followed by the next page, up to this many pages for each run. */
export const ADMIN_SEO_ALERT_MAX_PAGES = 8;
/** An alert whose `at` is older than this does not notify: it bounds the first run after a deploy. */
export const ADMIN_SEO_ALERT_NOTIFY_HOURS = 24;
const HOUR_MS = 3_600_000;

type AdminSeoAlertPage = {
  critical: number;
  items: Pick<AdminSeoAlert, "id" | "taskId" | "severity" | "at">[];
};

/**
 * The critical alerts of the last `ADMIN_SEO_ALERT_NOTIFY_HOURS`. The list is sorted critical first, then newest
 * `at` first, so the read stops at the first page that is short or ends with an alert that is not critical or is
 * too old. `at` is the newest change of the Run (analysis row, price marker, last Task status event): it is not
 * the time the alert became critical. `capped` says the page limit cut the read; `old` counts the critical alerts
 * that are too old to notify.
 */
export async function readAdminSeoAlerts(
  readPage: (page: number) => Promise<AdminSeoAlertPage>,
  now: Date,
) {
  const since = now.getTime() - ADMIN_SEO_ALERT_NOTIFY_HOURS * HOUR_MS;
  const isNew = (alert: AdminSeoAlertPage["items"][number]) =>
    alert.severity === "critical" && Date.parse(alert.at) >= since;
  const alerts: AdminSeoAlertPage["items"] = [];
  for (let page = 1; ; page++) {
    const { critical, items } = await readPage(page);
    alerts.push(...items.filter(isNew));
    const last = items.at(-1);
    if (items.length < SEO_ALERTS_PAGE_SIZE || !last || !isNew(last))
      return { critical, alerts, capped: false, old: critical - alerts.length };
    if (page === ADMIN_SEO_ALERT_MAX_PAGES)
      return { critical, alerts, capped: true, old: 0 };
  }
}

/**
 * Tells every platform admin about a new critical SEO alert, in the app. `critical` is the count of the whole
 * list and `read` the new critical alerts this run read. With `capped`, `critical - read` alerts were not read.
 */
export async function notifyAdminSeoAlerts(now = new Date()) {
  const { critical, alerts, capped, old } = await readAdminSeoAlerts(
    (page) => listAdminSeoAlerts({ period: ADMIN_SEO_ALERT_PERIOD, page }),
    now,
  );
  const counts = { critical, read: alerts.length, old, capped };
  if (!alerts.length) return { ...counts, sent: 0 };
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
  return { ...counts, sent: inputs.length };
}
