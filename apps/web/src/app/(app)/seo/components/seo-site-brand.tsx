"use client";
import type { SeoSiteTrafficReport } from "@sokosumi/core-client";
import { seoSearchTypeHasQueries } from "@sokosumi/utils";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  SEO_BRAND_BUCKETS,
  type SeoBrandBucket,
  seoBrandSuggestion,
  seoSiteBrandSplit,
} from "./seo-brand-model";
import { SeoBrandTermsEditor } from "./seo-brand-terms";
import { SeoSection } from "./seo-shared";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The branded split of the live traffic report: the share of each part, its trend per day,
 * and the owner's brand term list. The third part is traffic that Google lists under no query.
 */
export function SeoSiteBrand({
  model,
  report,
  metric,
  loading = false,
}: {
  model: SeoWorkspaceModel;
  report: SeoSiteTrafficReport;
  metric: "clicks" | "impressions";
  /** The split of a new term list is on its way: the report has none yet. */
  loading?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [chosen, setChosen] = useState<SeoBrandBucket>("branded");
  const terms = model.data.brandTerms ?? [];
  // Discover and Google News show pages in a feed: there are no queries to split.
  const feed = !seoSearchTypeHasQueries(model.filters.searchType ?? "web");
  if (feed || (!terms.length && !model.data.availableActions.canEdit))
    return null;
  const split = terms.length ? seoSiteBrandSplit(report, metric) : null;
  const bucket = split?.points[chosen] ? chosen : "branded";
  const points = split?.points[bucket] ?? [];
  const label = `${t(`siteTraffic.brandBuckets.${bucket}`)} · ${t(`siteTraffic.${metric}`)}`;
  return (
    <SeoSection title={t("traffic.brandSplit")}>
      <div className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-4 sm:p-5")}>
        {split ? (
          <>
            <dl className="flex flex-wrap gap-3">
              {SEO_BRAND_BUCKETS.map((key) => {
                const value = split.totals[key];
                if (value === null) return null;
                return (
                  <div
                    key={key}
                    className="relative rounded-md border px-3 py-2 has-[[aria-pressed=true]]:border-foreground"
                  >
                    <dt className="text-muted-foreground text-xs">
                      <button
                        type="button"
                        aria-pressed={bucket === key}
                        onClick={() => setChosen(key)}
                        className="after:absolute after:inset-0 after:rounded-md"
                      >
                        {t(`siteTraffic.brandBuckets.${key}`)}
                      </button>
                    </dt>
                    <dd className="text-xl font-semibold tabular-nums">
                      {format.number(value)}
                      {split.all ? (
                        <span className="text-muted-foreground text-sm font-normal">
                          {" "}
                          {format.number(value / split.all, {
                            style: "percent",
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-sm font-medium">{label}</p>
            {points.length ? (
              <SeoTrendChart
                series={{ source: "search_console", key: metric }}
                label={label}
                points={points}
                unit="count"
                unavailable={t("none")}
                formatValue={(v) => format.number(v)}
              />
            ) : (
              // No day totals and no listed query: the chart has no day to draw.
              <p className="text-muted-foreground text-sm">
                {t("overview.noDailyTrend")}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t(
                split.limited
                  ? "siteTraffic.brandLimited"
                  : split.totals.unlisted === null
                    ? "siteTraffic.brandListedOnly"
                    : "siteTraffic.brandUnlistedNote",
              )}
            </p>
          </>
        ) : (
          <p
            className="text-muted-foreground text-sm"
            role={loading ? "status" : undefined}
          >
            {t(
              !terms.length
                ? "siteTraffic.brandEmpty"
                : loading
                  ? "siteTraffic.brandLoading"
                  : "siteTraffic.brandUnavailable",
            )}
          </p>
        )}
        <SeoBrandTermsEditor
          // A save from the other term editor on the page closes this draft.
          key={terms.join("\n")}
          model={model}
          suggestion={seoBrandSuggestion(report.site)}
        />
      </div>
    </SeoSection>
  );
}
