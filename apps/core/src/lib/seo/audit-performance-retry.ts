import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

import { auditPageDiscoveryComplete } from "@/schemas/seo-page-discovery.schema";

/** A retry may recover individual Google reads. Never combine measurements for different page selections. */
export function preserveAuditPerformance(
  previous: NativeSeoMetrics,
  next: NativeSeoMetrics,
): NativeSeoMetrics {
  if (
    !previous.collectionFingerprint ||
    previous.collectionFingerprint !== next.collectionFingerprint ||
    !previous.auditMeasuredPages ||
    !next.auditMeasuredPages
  )
    return next;
  const auditPropertyTotals =
    previous.auditPropertyTotals ?? next.auditPropertyTotals;
  const auditPageDiscovery = auditPageDiscoveryComplete(
    previous.auditPageDiscovery,
  )
    ? previous.auditPageDiscovery
    : (next.auditPageDiscovery ?? previous.auditPageDiscovery);
  const property = {
    ...(auditPropertyTotals && { auditPropertyTotals }),
    ...(auditPageDiscovery && { auditPageDiscovery }),
  };
  const saved = { ...previous, ...property };
  if (previous.auditPerformanceComplete) {
    return previous.auditDiscovery?.status === "unavailable" &&
      next.auditDiscovery
      ? { ...saved, auditDiscovery: next.auditDiscovery }
      : saved;
  }
  const samePages = next.auditMeasuredPages.every((page) =>
    previous.auditMeasuredPages?.some(
      (old) =>
        old.pageUrl === page.pageUrl && old.measuredUrl === page.measuredUrl,
    ),
  );
  if (!samePages) {
    // An unanswered inspection must not discard Google's previously verified canonical.
    return next.auditMeasuredPages.some((page) => page.basis === "unverified")
      ? saved
      : { ...next, ...property };
  }
  // Google returns one aggregate row per period. Rates in a measured zero-impression row are undefined.
  const impressions = next.metrics.find(
    (metric) => metric.key === "impressions",
  );
  const hasCurrentRow = impressions?.value != null;
  const hasPreviousRow = impressions?.previous?.value != null;
  const metrics = next.metrics.map((metric) => {
    const old = previous.metrics.find((item) => item.key === metric.key);
    if (!old) return metric;
    return {
      ...metric,
      value: hasCurrentRow ? metric.value : old.value,
      points:
        metric.points.length || impressions?.value === 0
          ? metric.points
          : old.points,
      previous: hasPreviousRow
        ? metric.previous
        : (old.previous ?? metric.previous),
    };
  });
  return {
    ...next,
    ...property,
    metrics,
    queries: next.queries ?? previous.queries,
    coverage:
      next.coverage === "unavailable" && previous.coverage !== "unavailable"
        ? "partial"
        : next.coverage,
  };
}
