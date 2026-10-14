"use client";

import type {
  AdCampaignDailyMetrics,
  AdCampaignPerformance,
} from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import type { RangeParam } from "@/app/ads/ads-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { AdsDailyChart } from "./ads-daily-chart";
import { AdsFormSection } from "./ads-form-section";
import { adsDay, adsFormat } from "./ads-format";
import { AdsRangeToggle } from "./ads-range-toggle";

const TOTALS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
] as const;

/** The daily figures the chart can show, in the order of its switch. */
const CHART_METRICS = [
  "spend",
  "clicks",
  "impressions",
  "conversions",
] as const satisfies readonly (keyof AdCampaignDailyMetrics)[];

type ChartMetric = (typeof CHART_METRICS)[number];

interface AdsCampaignPerformanceProps {
  currency: string;
  performance: AdCampaignPerformance;
  range: RangeParam;
}

/**
 * A campaign's totals over the range, with the range switch, and one bar
 * chart of a day-by-day figure. A range without any activity says so instead
 * of drawing an empty chart.
 */
export function AdsCampaignPerformance({
  currency,
  performance,
  range,
}: AdsCampaignPerformanceProps) {
  const t = useTranslations("App.Ads.campaignDetails");
  const tColumns = useTranslations("App.Ads.campaigns.columns");
  const formatter = useFormatter();
  const [metric, setMetric] = useState<ChartMetric>("spend");
  const { money, count, percent } = adsFormat(formatter, currency);

  const { totals, daily } = performance;
  const totalCells: Record<(typeof TOTALS)[number], string> = {
    spend: money(totals.spend),
    impressions: count(totals.impressions),
    clicks: count(totals.clicks),
    ctr: percent(totals.ctr),
    cpc: money(totals.cpc),
    conversions: count(totals.conversions),
  };
  const figure = (key: ChartMetric, value: number) =>
    key === "spend" ? money(value) : count(value);
  const hasActivity = daily.some((day) =>
    CHART_METRICS.some((key) => day[key] > 0),
  );

  return (
    <AdsFormSection
      action={<AdsRangeToggle range={range} />}
      id="campaign-performance"
      title={t("sections.performance")}
    >
      <dl
        className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3"
        data-testid="performance-totals"
      >
        {TOTALS.map((key) => (
          <div key={key}>
            <dt className="text-muted-foreground text-sm">{tColumns(key)}</dt>
            <dd className="text-2xl font-light tabular-nums">
              {totalCells[key]}
            </dd>
          </div>
        ))}
      </dl>

      {hasActivity ? (
        <div className="flex flex-col gap-4">
          <ToggleGroup
            aria-label={t("performance.chartMetric")}
            onValueChange={(value) => {
              // Clicking the selected metric again would clear it; keep it.
              const next = CHART_METRICS.find(
                (candidate) => candidate === value,
              );
              if (next) setMetric(next);
            }}
            size="sm"
            type="single"
            value={metric}
          >
            {CHART_METRICS.map((candidate) => (
              <ToggleGroupItem key={candidate} value={candidate}>
                {tColumns(candidate)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <AdsDailyChart
            days={daily.map((day) => ({
              date: day.date,
              value: day[metric],
            }))}
            formatValue={(value) => figure(metric, value)}
            label={t("performance.chartLabel", { metric: tColumns(metric) })}
          />
          <table className="sr-only">
            <caption>{t("performance.tableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("performance.date")}</th>
                {CHART_METRICS.map((key) => (
                  <th key={key} scope="col">
                    {tColumns(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{adsDay(formatter, day.date)}</th>
                  {CHART_METRICS.map((key) => (
                    <td key={key}>{figure(key, day[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("performance.empty")}
        </p>
      )}
    </AdsFormSection>
  );
}
