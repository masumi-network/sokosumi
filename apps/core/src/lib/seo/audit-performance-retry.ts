import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

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
  if (previous.auditPerformanceComplete) {
    return previous.auditDiscovery?.status === "unavailable" &&
      next.auditDiscovery
      ? { ...previous, auditDiscovery: next.auditDiscovery }
      : previous;
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
      ? previous
      : next;
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
    metrics,
    queries: next.queries ?? previous.queries,
    coverage:
      next.coverage === "unavailable" && previous.coverage !== "unavailable"
        ? "partial"
        : next.coverage,
  };
}
