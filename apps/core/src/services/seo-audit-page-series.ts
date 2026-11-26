import type { Prisma } from "@sokosumi/database";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
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
  const { actor, access, period } = binding;
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
  const measured = nativeSeoMetricsSchema.safeParse(performance?.payload).data
    ?.auditMeasuredPages;
  if (!performance || !measured?.length) return;
  const pages = new Map(
    auditPageSeriesSchema
      .safeParse(stored?.payload)
      .data?.pages.map((page) => [page.pageUrl, page]),
  );
  if (measured.every((page) => pages.has(page.pageUrl))) return;
  const integration = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
  );
  if (
    !integration ||
    connectionVersion(integration) !== access.connectionVersion
  )
    return;
  const observedAt = new Date();
  const reads = await Promise.allSettled(
    measured.map(async (page) => {
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
      pages.set(page.pageUrl, {
        pageUrl: page.pageUrl,
        measuredUrl: page.measuredUrl,
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
  if (!pages.size) return;
  const payload: AuditPageSeries = {
    propertyId: access.propertyId,
    ...period,
    pages: [...pages.values()],
  };
  const row = {
    payload: jsonInput(payload),
    artifactHash: sha256(JSON.stringify(payload)),
    observedAt,
  };
  const sourceKey = auditPageSeriesKey(taskId);
  await serializableTransaction(async (tx) => {
    await authorize(tx);
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
        pageIds: performance.pageIds,
        ...row,
      },
      update: row,
    });
  }, "The audit changed during collection.");
}
