"use client";

import type { AdCampaignDailyMetrics } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { AdsDailyChart } from "./ads-daily-chart";
import { adsDay, adsFormat } from "./ads-format";

/** The daily figures the chart can show, in the order of its switch. */
const CHART_METRICS = [
  "spend",
  "clicks",
  "impressions",
  "conversions",
] as const satisfies readonly (keyof AdCampaignDailyMetrics)[];

type ChartMetric = (typeof CHART_METRICS)[number];

interface AdsPerformanceChartProps {
  currency: string;
  daily: readonly AdCampaignDailyMetrics[];
}

/**
 * The one client island of the performance block: the metric switch, the
 * daily chart of the chosen metric and the table of every day and metric for
 * screen readers, which follows the formatting of the chart.
 */
export function AdsPerformanceChart({
  currency,
  daily,
}: AdsPerformanceChartProps) {
  const t = useTranslations("App.Ads.campaignDetails.performance");
  const tColumns = useTranslations("App.Ads.campaigns.columns");
  const formatter = useFormatter();
  const [metric, setMetric] = useState<ChartMetric>("spend");
  const { money, count } = adsFormat(formatter, currency);
  const figure = (key: ChartMetric, value: number) =>
    key === "spend" ? money(value) : count(value);

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        aria-label={t("chartMetric")}
        onValueChange={(value) => {
          // Clicking the selected metric again would clear it; keep it.
          const next = CHART_METRICS.find((candidate) => candidate === value);
          if (next) setMetric(next);
        }}
        size="sm"
        type="single"
        value={metric}
        variant="outline"
      >
        {CHART_METRICS.map((candidate) => (
          <ToggleGroupItem key={candidate} value={candidate}>
            {tColumns(candidate)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <AdsDailyChart
        days={daily.map((day) => ({ date: day.date, value: day[metric] }))}
        formatValue={(value) => figure(metric, value)}
        label={t("chartLabel", { metric: tColumns(metric) })}
      />
      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("date")}</th>
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
  );
}
