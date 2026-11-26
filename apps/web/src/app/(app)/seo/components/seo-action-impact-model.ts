import type { ProjectSeoActionImpact } from "@sokosumi/core-client";
import { SEO_IMPACT_SETTLE_DAYS, seoImpactPercent } from "@sokosumi/utils";

const DAY_MS = 86_400_000;

export interface SeoActionImpactRow {
  metric: "clicks" | "impressions" | "position";
  before: number | null;
  after: number | null;
  /** Counts only, and only when both are high enough for a percent to mean something. */
  percent: number | null;
}

/** The three figures side by side, and the first day a too-early comparison can be read. */
export function seoActionImpactModel(impact: ProjectSeoActionImpact): {
  rows: SeoActionImpactRow[];
  readableFrom: string;
} {
  const { before, after } = impact;
  const count = (metric: "clicks" | "impressions"): SeoActionImpactRow => ({
    metric,
    before: before?.[metric] ?? null,
    after: after?.[metric] ?? null,
    percent:
      before && after ? seoImpactPercent(before[metric], after[metric]) : null,
  });
  return {
    rows: [
      count("clicks"),
      count("impressions"),
      {
        metric: "position",
        before: before?.position ?? null,
        after: after?.position ?? null,
        percent: null,
      },
    ],
    readableFrom: new Date(
      Date.parse(`${impact.anchor}T00:00:00Z`) +
        (impact.days + SEO_IMPACT_SETTLE_DAYS) * DAY_MS,
    )
      .toISOString()
      .slice(0, 10),
  };
}
