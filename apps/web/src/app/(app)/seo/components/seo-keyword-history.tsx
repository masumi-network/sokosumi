"use client";

import type { ReactNode } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import {
  SeoKeywordTrendChart,
  SeoKeywordTrendReason,
} from "./seo-keyword-trend";
import { seoRankShownTop } from "./seo-rank-detail-model";
import type { SeoRankSeries } from "./seo-rank-history-model";
import type { SeoKeywordTrend } from "./seo-search-model";
import { SeoSerpFeatures } from "./seo-serp-features";
import type { SeoSerpMarker } from "./seo-serp-features-model";
import { SeoTrendChart } from "./seo-trend-chart";

function HistoryPart({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section lang="en" className="min-w-0 space-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="text-muted-foreground text-xs">{note}</p>
      {children}
    </section>
  );
}

/**
 * The open row under a tracked keyword: the positions of the paid checks next to the Search Console daily
 * average, and what the results page showed on each check. The two positions are different numbers: one check of
 * the results against an average over the day's impressions.
 */
export function SeoKeywordHistory({
  keyword,
  trend,
  series,
  marks,
}: {
  keyword: string;
  trend: SeoKeywordTrend;
  series: SeoRankSeries[];
  marks: SeoSerpMarker[];
}) {
  const t = useSeoResultTranslations("App.Seo.keywords");
  const format = useSeoResultFormatter();
  // One date axis for the paid checks and the Search Console days: the same day sits at the same place in both.
  const dates = [
    ...series.flatMap((item) => item.points),
    ...(trend.state === "measured" ? trend.points : []),
  ]
    .map((point) => point.date)
    .toSorted();
  const first = dates.at(0);
  const last = dates.at(-1);
  const domain =
    series.length && trend.state === "measured" && first && last
      ? { from: first, to: last }
      : undefined;
  const searchConsole =
    trend.state === "measured" ? (
      <SeoKeywordTrendChart
        keyword={keyword}
        points={trend.points}
        truncated={trend.truncated}
        domain={domain}
      />
    ) : (
      <SeoKeywordTrendReason trend={trend} />
    );
  // Without paid checks the row is the daily chart alone, as before.
  if (!series.length && !marks.length) return searchConsole;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {series.length ? (
        <HistoryPart
          title={t("historyPaidTitle")}
          note={
            series.some((item) => item.cut)
              ? `${t("historyPaidNote")} ${t("historyOlderHidden")}`
              : t("historyPaidNote")
          }
        >
          {series.map((item) =>
            item.points.length ? (
              <SeoTrendChart
                report
                key={item.device ?? "all"}
                points={item.points}
                unit="position"
                // Not a Search Console metric: its data anomalies stay off the paid checks.
                series={{ source: "serp", key: "position" }}
                joinReads
                label={t("historyPaidLabel", {
                  keyword,
                  device: item.device ?? "all",
                })}
                formatValue={(value) => format.number(value)}
                unavailable={t("historyNotInRange")}
                outsideLabel={(top) =>
                  top === null
                    ? t("historyNotInRange")
                    : t("historyNotInTop", { count: seoRankShownTop(top) })
                }
                domain={domain}
                positionNote={t("historyPaidAxis")}
              />
            ) : null,
          )}
        </HistoryPart>
      ) : null}
      {trend.state === "absent" ? null : (
        <HistoryPart title={t("historyGscTitle")} note={t("historyGscNote")}>
          {searchConsole}
        </HistoryPart>
      )}
      {marks.length ? (
        <div className="min-w-0 lg:col-span-2">
          <SeoSerpFeatures marks={marks} />
        </div>
      ) : null}
    </div>
  );
}
