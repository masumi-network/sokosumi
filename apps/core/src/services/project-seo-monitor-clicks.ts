import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { searchConsoleSettledEnd } from "@/lib/seo/native-statistics";
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
/**
 * The most days between the end of the measured period and now: the lag of final data (3 days) and one week. An older
 * period says nothing about the site at the time of this Run, also when it was synced today.
 */
export const SEO_CLICKS_MAX_PERIOD_AGE_DAYS = 10;
/**
 * Newest Search Console rows of the Owner read to find the one of web search for the monitored site. Discover and
 * Google News syncs and syncs of other sites are stored beside it, so the choice is made over this many rows.
 */
const SEO_CLICKS_ROWS = 50;
const DAY_MS = 86_400_000;

export interface SeoClicksDrop {
  site: string;
  clicksFrom: number;
  clicksTo: number;
  /** The measured property, site and the two compared periods. One alert per scope and pair. */
  event: string;
}

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const daysOf = (period: { from: string; to: string }) =>
  Math.round((dayOf(period.to) - dayOf(period.from)) / DAY_MS) + 1;
/** A site and its www host are the same site. */
const bareHost = (host: string) => host.replace(/^www\./, "");

/**
 * The newest stored row that measures web search of the monitored site (a host), or undefined. `payloads` is newest
 * first.
 * A row of another site of the same collection, or of Discover or Google News, is passed over.
 */
export function newestSeoClicksRow(
  payloads: unknown[],
  site: string,
): NativeSeoMetrics | undefined {
  for (const payload of payloads) {
    const { data } = nativeSeoMetricsSchema.safeParse(payload);
    if (
      data?.provider === "search_console" &&
      (data.searchType ?? "web") === "web" &&
      data.pageUrls.every(
        (url) => bareHost(new URL(url).hostname) === bareHost(site),
      )
    )
      return data;
  }
  return undefined;
}

/**
 * A fall in Search Console clicks against the equal period before, or null. Only a row that compares like with like
 * alerts: a read that returned rows, and a current window of as many days as the earlier one that Google had settled
 * when it was read (GSC_FINAL_LAG_DAYS), so a reporting delay or a shorter period never reads as a drop.
 * A dashboard sync asks up to yesterday and compares the days up to the settled end (collectPrevious): the earlier
 * period has that many days, so the measured window is counted from `from` with the earlier period's length.
 */
export function seoClicksDrop(
  metrics: NativeSeoMetrics,
  now = new Date(),
): SeoClicksDrop | null {
  if (
    metrics.provider !== "search_console" ||
    (metrics.searchType ?? "web") !== "web" ||
    // A dashboard sync always stores "partial" (normalizeGscStatistics), so only a read with no rows is left out.
    metrics.coverage === "unavailable"
  )
    return null;
  const clicks = metrics.metrics.find((metric) => metric.key === "clicks");
  const before = clicks?.previous;
  if (!clicks || clicks.value === null || !before || before.value === null)
    return null;
  const days = daysOf(before);
  const end = new Date(dayOf(metrics.from) + (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const readAt = new Date(metrics.collectedAt ?? metrics.observedAt);
  if (
    end > metrics.to ||
    days < SEO_CLICKS_MIN_PERIOD_DAYS ||
    // The days were final when Google was read. A later import does not make an early read final.
    searchConsoleSettledEnd(end, "", readAt) !== end ||
    // The window ends with its last day.
    dayOf(end) + DAY_MS <
      now.getTime() - SEO_CLICKS_MAX_PERIOD_AGE_DAYS * DAY_MS ||
    before.value < SEO_CLICKS_DROP_MIN_PREVIOUS ||
    (before.value - clicks.value) * 100 < before.value * SEO_CLICKS_DROP_PERCENT
  )
    return null;
  const site = new URL(metrics.pageUrls[0]).hostname;
  return {
    site,
    clicksFrom: before.value,
    clicksTo: clicks.value,
    event: `${metrics.propertyId}:${site}:${before.from}:${before.to}:${metrics.from}:${end}`,
  };
}

/**
 * Tells the monitor's Owner when the Search Console clicks they synced last for the monitored site fell. Reads only
 * the Owner's own metrics rows of the monitor's collection, and the result goes only into their notification. No
 * Search Console read happens here: the row is the one a statistics sync stored.
 */
export async function notifySeoMonitorClicksDrop(
  taskId: string,
  observationId: string,
  now = new Date(),
): Promise<void> {
  const task = await seoMonitorRunOf(taskId);
  if (!task) return;
  const result = await prisma.projectSeoObservation.findUnique({
    where: { id: observationId },
    select: { payload: true },
  });
  const monitored = publicSeoPayloadSchema.safeParse(result?.payload);
  if (!monitored.success) return;
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(task.owner),
      ownerId: task.ownerId,
      kind: "metrics",
      source: "search_console",
      // Bounds the read only. A period that ended inside the limit was read inside it; seoClicksDrop decides.
      observedAt: {
        gte: new Date(now.getTime() - SEO_CLICKS_MAX_PERIOD_AGE_DAYS * DAY_MS),
      },
    },
    orderBy: { observedAt: "desc" },
    take: SEO_CLICKS_ROWS,
    select: { payload: true },
  });
  const newest = newestSeoClicksRow(
    rows.map((row) => row.payload),
    new URL(monitored.data.pageUrls[0]).hostname,
  );
  const drop = newest && seoClicksDrop(newest, now);
  if (!drop) return;
  const { event, ...params } = drop;
  await sendSeoMonitorNotification(
    task.owner,
    {
      userId: task.ownerId,
      workspaceId: task.workspaceId,
      kind: NotificationKind.TASK,
      referenceId: taskId,
      eventId: `${task.owner.owner.id}:${event}`,
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
  observationId: string,
): Promise<void> {
  try {
    await notifySeoMonitorClicksDrop(taskId, observationId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: "seo-monitor-clicks" },
      extra: { taskId, observationId },
    });
  }
}
