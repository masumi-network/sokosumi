import type { Prisma } from "@sokosumi/database";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  GSC_RETENTION_DAYS,
  GSC_STATS_TOOL,
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
  normalizeGscStatistics,
  SEO_STATS_MAX_ROWS,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import {
  AUDIT_PAGE_SERIES_KIND,
  type AuditPageSeries,
  auditPageSeriesKey,
  auditPageSeriesSchema,
} from "@/schemas/seo-action-impact.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { readNativeSeoTool } from "./project-seo-statistics.service";
import {
  normalizeSeoUrl,
  seoOwnerData,
  seoOwnerUnique,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

/**
 * How far back each page is read. One read returns one row per day and at most
 * SEO_STATS_MAX_ROWS rows, so this is the longest history one read per page
 * holds. It lets an action done months before the audit keep its before-window.
 */
const AUDIT_PAGE_SERIES_DAYS = SEO_STATS_MAX_ROWS;
const DAY_MS = 86_400_000;

/**
 * Store the daily Search Console rows of each audit page alone. The audit's own
 * statistics filter all its pages together, so they cannot show what one page did.
 */
export async function collectSeoAuditPageSeries(
  taskId: string,
  binding: {
    actor: SeoActor;
    access: { propertyId: string; connectionVersion: string };
    period: { from: string; to: string };
  },
  authorize: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const { actor, access } = binding;
  const observedAt = new Date();
  // Google returns no rows for a day it no longer keeps. Such a day must not be stored as a day without traffic.
  const period = {
    from: new Date(
      Math.max(
        Date.parse(`${binding.period.to}T00:00:00Z`) -
          (AUDIT_PAGE_SERIES_DAYS - 1) * DAY_MS,
        observedAt.getTime() - (GSC_RETENTION_DAYS - 1) * DAY_MS,
      ),
    )
      .toISOString()
      .slice(0, 10),
    to: binding.period.to,
  };
  if (period.from > period.to) return;
  const where = {
    ...seoOwnerWhere(actor),
    ownerId: actor.userId,
    visibility: "PRIVATE",
    sourceTaskId: taskId,
  };
  const [performance, stored] = await Promise.all([
    prisma.projectSeoObservation.findFirst({
      where: { ...where, kind: AUDIT_PERFORMANCE_KIND },
      select: { payload: true, pageIds: true },
    }),
    prisma.projectSeoObservation.findFirst({
      where: { ...where, kind: AUDIT_PAGE_SERIES_KIND },
      select: { payload: true },
    }),
  ]);
  // An unverified address is a guess: Google can count the page's traffic under another address.
  const verifiedPages = (payload: unknown) =>
    nativeSeoMetricsSchema
      .safeParse(payload)
      .data?.auditMeasuredPages?.filter((page) => page.basis !== "unverified");
  const measured = verifiedPages(performance?.payload);
  if (!performance || !measured?.length) return;
  // A stored page keeps the range it was read for. A late retry reads fewer days and must not shorten it.
  const storedPages = (payload: unknown) => {
    const data = auditPageSeriesSchema.safeParse(payload).data;
    return data?.propertyId === access.propertyId
      ? data.pages.map((page) => ({ from: data.from, to: data.to, ...page }))
      : [];
  };
  const pages = new Map(
    storedPages(stored?.payload).map((page) => [page.pageUrl, page]),
  );
  // A page whose verified address changed since its read is read again under the new address.
  const missing = measured.filter(
    (page) => pages.get(page.pageUrl)?.measuredUrl !== page.measuredUrl,
  );
  if (!missing.length) return;
  const integration = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
  );
  if (
    !integration ||
    connectionVersion(integration) !== access.connectionVersion
  )
    return;
  const fresh = new Map<string, ReturnType<typeof storedPages>[number]>();
  const reads = await Promise.allSettled(
    missing.map(async (page) => {
      const query: NativeStatisticsQuery = {
        provider: "search_console",
        propertyId: access.propertyId,
        pageUrls: [page.measuredUrl],
        ...period,
        channel: "organic",
        searchType: "web",
      };
      const { metrics } = normalizeGscStatistics(
        query,
        null,
        unwrapNativeStatistics(
          await readNativeSeoTool(
            integration,
            GSC_STATS_TOOL,
            gscSearchAnalyticsArguments(
              query,
              ["date"],
              SEO_STATS_MAX_ROWS,
              "equals",
            ),
          ),
          ["rows"],
        ),
        observedAt.toISOString(),
      );
      const points = (key: string) =>
        metrics.find((metric) => metric.key === key)?.points ?? [];
      const impressions = new Map(
        points("impressions").map((point) => [point.date, point.value]),
      );
      const position = new Map(
        points("position").map((point) => [point.date, point.value]),
      );
      fresh.set(page.pageUrl, {
        pageUrl: page.pageUrl,
        measuredUrl: page.measuredUrl,
        ...period,
        days: points("clicks").map((point) => ({
          date: point.date,
          clicks: point.value ?? 0,
          impressions: impressions.get(point.date) ?? 0,
          position: position.get(point.date) ?? null,
        })),
      });
    }),
  );
  const failed = reads.find((read) => read.status === "rejected");
  // A page whose read failed stays out of the row. An empty list would read as a page without traffic.
  if (failed)
    recordCoreWarning(
      { operation: "seo_audit_page_series", taskId },
      {
        message: "Could not read every audit page's daily Search Console rows",
        why: "A page read failed or its response could not be validated.",
      },
      {
        failedPages: reads.filter((read) => read.status === "rejected").length,
        failure: messageSafeErrorFields(failed.reason),
      },
    );
  if (!fresh.size) return;
  const sourceKey = auditPageSeriesKey(taskId);
  await serializableTransaction(async (tx) => {
    await authorize(tx);
    // Another collection of this audit can have stored a page since the read above. Of two reads of one address, the longer range stays.
    const latest = await tx.projectSeoObservation.findFirst({
      where: { ...where, kind: AUDIT_PAGE_SERIES_KIND },
      select: { payload: true },
    });
    const merged = new Map(
      storedPages(latest?.payload).map((page) => [page.pageUrl, page]),
    );
    // A retry can have verified another address since this read began. A read of the old address is dropped.
    const current = await tx.projectSeoObservation.findFirst({
      where: { ...where, kind: AUDIT_PERFORMANCE_KIND },
      select: { payload: true },
    });
    const verified = new Map(
      verifiedPages(current?.payload)?.map((page) => [
        page.pageUrl,
        page.measuredUrl,
      ]),
    );
    let changed = false;
    for (const page of fresh.values()) {
      const held = merged.get(page.pageUrl);
      if (verified.get(page.pageUrl) !== page.measuredUrl) continue;
      if (
        !held ||
        held.measuredUrl !== page.measuredUrl ||
        page.from < held.from
      ) {
        merged.set(page.pageUrl, page);
        changed = true;
      }
    }
    if (!changed) return;
    const payload: AuditPageSeries = {
      propertyId: access.propertyId,
      ...period,
      pages: [...merged.values()],
    };
    // Only a page with stored days counts as a page of this row: a reader limits the rows it takes per page.
    const held = new Set(
      payload.pages.map((page) => normalizeSeoUrl(page.pageUrl)),
    );
    const owned = await tx.projectSeoPage.findMany({
      where: { ...seoOwnerWhere(actor), id: { in: performance.pageIds } },
      select: { id: true, url: true },
    });
    const row = {
      pageIds: owned
        .filter((page) => held.has(page.url))
        .map((page) => page.id),
      payload: jsonInput(payload),
      artifactHash: sha256(JSON.stringify(payload)),
      observedAt,
    };
    await tx.projectSeoObservation.upsert({
      where: seoOwnerUnique(actor, "sourceKey", { sourceKey }),
      create: {
        ...seoOwnerData(actor),
        kind: AUDIT_PAGE_SERIES_KIND,
        source: "search_console",
        sourceKey,
        sourceTaskId: taskId,
        ownerId: actor.userId,
        visibility: "PRIVATE",
        ...row,
      },
      update: row,
    });
  }, "The audit changed during collection.");
}
