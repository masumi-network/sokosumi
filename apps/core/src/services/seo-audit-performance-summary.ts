import prisma from "@/lib/db/prisma";
import { auditDiscoveryResult } from "@/lib/seo/audit-discovery-actions";
import { withinSearchConsoleRetention } from "@/lib/seo/native-statistics";
import { searchOpportunities } from "@/lib/seo/search-opportunities";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type NativeSeoMetrics,
  nativeSeoMetricsSchema,
} from "@/schemas/project-seo-native-metrics.schema";
import {
  AUDIT_PAGE_SERIES_KIND,
  auditPageSeriesSchema,
} from "@/schemas/seo-action-impact.schema";
import {
  AUDIT_PERFORMANCE_KIND,
  AUDIT_QUERY_PREVIEW_LIMIT,
} from "@/schemas/seo-audit-performance.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import { seoOwnerWhere } from "./project-seo-store";
import { readPublicAuditSitemaps } from "./seo-audit-public-sitemaps";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

function totals(data: NativeSeoMetrics, previous = false) {
  function value(key: string) {
    const metric = data.metrics.find((metric) => metric.key === key);
    return (previous ? metric?.previous?.value : metric?.value) ?? null;
  }
  return {
    clicks: value("clicks"),
    impressions: value("impressions"),
    ctr: value("ctr"),
    averagePosition: value("position"),
  };
}

/** A retry reads Google through the connection the audit approved. After a switch to another account, every retry fails. */
async function retryableAudits(actor: SeoActor, taskIds: string[]) {
  if (!taskIds.length) return new Set<string>();
  const current = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
  );
  if (!current) return new Set<string>();
  const version = connectionVersion(current);
  const analyses = await prisma.projectSeoAnalysis.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, request: true },
  });
  return new Set(
    analyses.flatMap((analysis) =>
      analysis.taskId &&
      storedSeoAuditSearchConsoleSchema.safeParse(analysis.request).data
        ?.searchConsoleAccess?.connectionVersion === version
        ? [analysis.taskId]
        : [],
    ),
  );
}

/**
 * Read original run evidence for a human. The snapshot is independent of dashboard date filters.
 * It follows its audit Task: the caller passes only Tasks the reader may see, so a member reads
 * the snapshot of a public audit a colleague requested. `retryCandidates` stay the reader's own
 * audits, because a retry reads Google through the reader's own connection.
 * Property-wide totals, page discovery and submitted sitemaps go past the audit's pages, and
 * the requester agreed to them for their own report only, so a colleague does not get them.
 */
export async function readAuditPerformanceSummaries(
  actor: SeoActor,
  taskIds: string[],
  retryCandidates: string[] = [],
  selectedUrls?: ReadonlySet<string>,
) {
  if (actor.sokoBotId || !taskIds.length)
    return { auditSearchConsole: [], auditSearchConsoleRetryTaskIds: [] };
  const retry = await retryableAudits(actor, retryCandidates);
  const observations = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PERFORMANCE_KIND,
      source: "search_console",
      sourceTaskId: { in: taskIds },
    },
    select: { sourceTaskId: true, ownerId: true, payload: true },
  });
  // A retry also reads each page's daily rows. A page whose read failed has no impact until then.
  const series = retry.size
    ? await prisma.projectSeoObservation.findMany({
        where: {
          ...seoOwnerWhere(actor),
          kind: AUDIT_PAGE_SERIES_KIND,
          ownerId: actor.userId,
          sourceTaskId: { in: [...retry] },
        },
        select: { sourceTaskId: true, payload: true },
      })
    : [];
  const storedPages = new Map(
    series.map((row) => {
      const data = auditPageSeriesSchema.safeParse(row.payload).data;
      return [
        row.sourceTaskId,
        new Set(
          data?.pages.map(
            (page) => `${data.propertyId} ${page.pageUrl} ${page.measuredUrl}`,
          ),
        ),
      ];
    }),
  );
  const withDiscovery = observations.flatMap((row) =>
    row.sourceTaskId &&
    row.ownerId === actor.userId &&
    nativeSeoMetricsSchema.safeParse(row.payload).data?.auditDiscovery
      ? [row.sourceTaskId]
      : [],
  );
  const publicRoots = withDiscovery.length
    ? await readPublicAuditSitemaps(actor, withDiscovery)
    : new Map<string, string[]>();
  const auditSearchConsole = observations.flatMap((row) => {
    const data = nativeSeoMetricsSchema.safeParse(row.payload).data;
    if (
      !row.sourceTaskId ||
      !data?.auditMeasuredPages ||
      data.provider !== "search_console"
    )
      return [];
    const stored = storedPages.get(row.sourceTaskId);
    if (
      data.auditPerformanceComplete &&
      data.auditDiscovery?.status !== "unavailable" &&
      !(
        withinSearchConsoleRetention(data.to) &&
        data.auditMeasuredPages.some(
          (page) =>
            page.basis !== "unverified" &&
            !stored?.has(
              `${data.propertyId} ${page.pageUrl} ${page.measuredUrl}`,
            ),
        )
      )
    )
      retry.delete(row.sourceTaskId);
    const requester = row.ownerId === actor.userId;
    const earlier = data.metrics.find((metric) => metric.previous)?.previous;
    return [
      {
        taskId: row.sourceTaskId,
        ...(requester && { requester }),
        propertyId: data.propertyId,
        ...(!withinSearchConsoleRetention(data.from) && {
          propertyDataExpired: true as const,
        }),
        pageUrls: data.pageUrls,
        from: data.from,
        to: data.to,
        measuredPages: data.auditMeasuredPages,
        opportunities: searchOpportunities({
          propertyId: data.propertyId,
          from: data.from,
          to: data.to,
          rows: data.queries?.rows ?? [],
        }).map(({ id, title, why, pageUrl, expectedEffect, evidence }) => ({
          id,
          title,
          why,
          pageUrl,
          expectedEffect,
          evidence,
        })),
        coverage: data.coverage,
        ...(requester &&
          data.auditDiscovery && {
            discovery: auditDiscoveryResult(
              data.auditDiscovery,
              data.propertyId,
              publicRoots.get(row.sourceTaskId) ?? [],
            ),
          }),
        ...((data.searchType ?? "web") === "web" &&
          data.countries &&
          data.pageUrls.length > 0 &&
          data.pageUrls.every((url) => selectedUrls?.has(url)) &&
          data.auditMeasuredPages.length > 0 &&
          data.auditMeasuredPages.every(
            (page) => page.basis !== "unverified",
          ) &&
          data.countries.rows.every((row) => /^[A-Z]{2,3}$/.test(row.key)) && {
            countries: data.countries,
          }),
        ...(data.auditClickHistory && { history: data.auditClickHistory }),
        ...totals(data),
        ...(requester &&
          data.auditPageDiscovery && {
            pageDiscovery: data.auditPageDiscovery,
          }),
        ...(requester &&
          data.auditPropertyTotals && {
            propertyTotals: data.auditPropertyTotals,
          }),
        previous: earlier
          ? { from: earlier.from, to: earlier.to, ...totals(data, true) }
          : null,
        queries: data.queries
          ? {
              rows: data.queries.rows.slice(0, AUDIT_QUERY_PREVIEW_LIMIT),
              truncated:
                data.queries.truncated ||
                data.queries.rows.length > AUDIT_QUERY_PREVIEW_LIMIT,
            }
          : null,
      },
    ];
  });
  return { auditSearchConsole, auditSearchConsoleRetryTaskIds: [...retry] };
}
