import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";

import {
  sendSeoMonitorNotification,
  seoMonitorRunOf,
} from "./project-seo-monitor-notify";
import { seoOwnerWhere } from "./project-seo-store";

export const SEO_MONITOR_CLICKS_DROP_MESSAGE_KEY =
  "Notifications.Task.seoMonitorClicksDrop";
/** Below this many clicks in the earlier period a percent change is noise. */
export const SEO_CLICKS_DROP_MIN_PREVIOUS = 50;
/** The smallest fall, in percent of the earlier period, that alerts. */
export const SEO_CLICKS_DROP_PERCENT = 30;
/** Shorter periods swing with the weekday. */
export const SEO_CLICKS_MIN_PERIOD_DAYS = 7;
/** An older sync says nothing about the site at the time of this Run. */
const SEO_CLICKS_MAX_AGE_DAYS = 7;
/** Newest rows read to find one of web search: Discover and Google News syncs are stored beside it. */
const SEO_CLICKS_ROWS = 10;
const DAY_MS = 86_400_000;

export interface SeoClicksDrop {
  site: string;
  clicksFrom: number;
  clicksTo: number;
  /** The two compared periods. One alert per pair. */
  periods: string;
}

/**
 * A fall in Search Console clicks against the equal period before, or null. The sync sets the earlier period to as
 * many days as Google has settled in the current one (GSC_FINAL_LAG_DAYS), so its length is the count of final days
 * compared and a reporting delay never reads as a drop.
 */
export function seoClicksDrop(metrics: NativeSeoMetrics): SeoClicksDrop | null {
  if (
    metrics.provider !== "search_console" ||
    (metrics.searchType ?? "web") !== "web" ||
    metrics.coverage === "unavailable"
  )
    return null;
  const clicks = metrics.metrics.find((metric) => metric.key === "clicks");
  const before = clicks?.previous;
  if (!clicks || clicks.value === null || !before || before.value === null)
    return null;
  const days =
    Math.round((Date.parse(before.to) - Date.parse(before.from)) / DAY_MS) + 1;
  if (
    days < SEO_CLICKS_MIN_PERIOD_DAYS ||
    before.value < SEO_CLICKS_DROP_MIN_PREVIOUS ||
    (before.value - clicks.value) * 100 < before.value * SEO_CLICKS_DROP_PERCENT
  )
    return null;
  return {
    site: new URL(metrics.pageUrls[0]).hostname,
    clicksFrom: before.value,
    clicksTo: clicks.value,
    periods: `${before.from}:${before.to}:${metrics.from}:${metrics.to}`,
  };
}

/**
 * Tells the monitor's Owner when the Search Console clicks they synced last fell. Reads only the Owner's own metrics
 * rows of the monitor's collection, and the result goes only into their notification. No Search Console read happens
 * here: the row is the one a statistics sync stored.
 */
export async function notifySeoMonitorClicksDrop(
  taskId: string,
  now = new Date(),
): Promise<void> {
  const task = await seoMonitorRunOf(taskId);
  if (!task) return;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(task.owner),
      ownerId: task.ownerId,
      kind: "metrics",
      source: "search_console",
      observedAt: {
        gte: new Date(now.getTime() - SEO_CLICKS_MAX_AGE_DAYS * DAY_MS),
      },
    },
    orderBy: { observedAt: "desc" },
    take: SEO_CLICKS_ROWS,
    select: { payload: true },
  });
  const newest = rows
    .map((row) => nativeSeoMetricsSchema.safeParse(row.payload).data)
    .find((data) => data && (data.searchType ?? "web") === "web");
  const drop = newest && seoClicksDrop(newest);
  if (!drop) return;
  const { periods, ...params } = drop;
  const eventId = `${task.owner.owner.id}:${periods}`;
  await sendSeoMonitorNotification(
    task.owner,
    {
      userId: task.ownerId,
      workspaceId: task.workspaceId,
      kind: NotificationKind.TASK,
      referenceId: taskId,
      eventId,
      messageKey: SEO_MONITOR_CLICKS_DROP_MESSAGE_KEY,
      messageParams: { taskName: task.name, ...params },
    },
    // Every later Run of the monitor finds the same two periods until the Owner syncs again: one alert per pair.
    {},
  );
}

/** After the import committed. A failed notification never fails the import. */
export async function notifySeoMonitorClicksDropSafely(
  taskId: string,
): Promise<void> {
  try {
    await notifySeoMonitorClicksDrop(taskId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: "seo-monitor-clicks" },
      extra: { taskId },
    });
  }
}
