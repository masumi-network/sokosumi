import prisma from "@/lib/db/prisma";
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
  const auditSearchConsole = observations.flatMap((row) => {
    const data = nativeSeoMetricsSchema.safeParse(row.payload).data;
    if (
      !row.sourceTaskId ||
      !data?.auditMeasuredPages ||
      data.provider !== "search_console"
    )
      return [];
    if (data.auditPerformanceComplete) retry.delete(row.sourceTaskId);
    const earlier = data.metrics.find((metric) => metric.previous)?.previous;
    return [
      {
        taskId: row.sourceTaskId,
        propertyId: data.propertyId,
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
        ...(data.auditClickHistory && { history: data.auditClickHistory }),
        ...totals(data),
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
