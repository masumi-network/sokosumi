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
  AUDIT_PERFORMANCE_KIND,
  AUDIT_QUERY_PREVIEW_LIMIT,
} from "@/schemas/seo-audit-performance.schema";
import { seoOwnerWhere } from "./project-seo-store";
import { readPublicAuditSitemaps } from "./seo-audit-public-sitemaps";

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

/** Read original run evidence for the human requester. The private snapshot is independent of dashboard date filters. */
export async function readAuditPerformanceSummaries(
  actor: SeoActor,
  taskIds: string[],
  retryCandidates: string[] = [],
  selectedUrls?: ReadonlySet<string>,
) {
  const retry = new Set(retryCandidates);
  if (actor.sokoBotId || !taskIds.length)
    return { auditSearchConsole: [], auditSearchConsoleRetryTaskIds: [] };
  const observations = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: AUDIT_PERFORMANCE_KIND,
      source: "search_console",
      sourceTaskId: { in: taskIds },
      ownerId: actor.userId,
      visibility: "PRIVATE",
    },
    select: { sourceTaskId: true, payload: true },
  });
  const withDiscovery = observations.flatMap((row) =>
    row.sourceTaskId &&
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
    if (
      data.auditPerformanceComplete &&
      data.auditDiscovery?.status !== "unavailable"
    )
      retry.delete(row.sourceTaskId);
    const earlier = data.metrics.find((metric) => metric.previous)?.previous;
    return [
      {
        taskId: row.sourceTaskId,
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
        ...(data.auditDiscovery && {
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
        ...(data.auditPageDiscovery && {
          pageDiscovery: data.auditPageDiscovery,
        }),
        ...(data.auditPropertyTotals && {
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
