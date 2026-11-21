import type { SeoIndexedPage } from "@/schemas/project-seo.schema";
import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";
import { auditPerformancePage } from "./audit-performance-pages";

export function trafficPageAliases(
  property: string,
  pageUrls: string[],
  inspections: SeoIndexedPage[],
) {
  const aliases: Record<string, string> = {};
  for (const pageUrl of pageUrls) {
    const page = auditPerformancePage(
      property,
      pageUrl,
      inspections.find((item) => item.pageUrl === pageUrl),
    );
    if (page.basis === "google_canonical") aliases[pageUrl] = page.measuredUrl;
  }
  return aliases;
}

export function trafficPageAliasesChanged(
  data: NativeSeoMetrics,
  aliases: Record<string, string>,
) {
  return data.pageUrls.some(
    (url) => data.trafficPageAliases?.[url] !== aliases[url],
  );
}

/** Keep query actions and keyword tracking on a selected page. Count a shared canonical once. */
export function retainTrafficPageScope(
  data: NativeSeoMetrics,
  pageUrls: string[],
  aliases: Record<string, string>,
) {
  data.pageUrls = pageUrls;
  if (!Object.keys(aliases).length) return;
  data.trafficPageAliases = aliases;
  const selectedByMeasured = new Map<string, string>();
  for (const pageUrl of pageUrls) {
    const measured = aliases[pageUrl] ?? pageUrl;
    if (measured === pageUrl || !selectedByMeasured.has(measured))
      selectedByMeasured.set(measured, pageUrl);
  }
  for (const row of data.queries?.rows ?? [])
    row.pageUrl = selectedByMeasured.get(row.pageUrl) ?? row.pageUrl;
}
