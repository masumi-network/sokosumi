"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DailyBarChart } from "@/components/performance/daily-bar-chart";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TrendMetric =
  | "interactions"
  | "impressions"
  | "views"
  | "postCount";

export interface TrendDay {
  date: string | Date;
  postCount: number;
  views: number | null;
  impressions: number | null;
  interactions: number | null;
}

function dayKey(value: string | Date) {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

export function visibleTrendMetrics(
  days: TrendDay[],
  impressionBased: boolean,
): TrendMetric[] {
  const measured = {
    postCount: true,
    interactions:
      days.some((day) => day.interactions != null) || !impressionBased,
    views: days.some((day) => day.views != null) || !impressionBased,
    impressions: days.some((day) => day.impressions != null) || impressionBased,
  };
  return (
    ["interactions", "impressions", "views", "postCount"] as const
  ).filter(
    (metric) =>
      metric === "postCount" ||
      (metric === "impressions" ? measured.impressions : measured[metric]),
  );
}

export function PerformanceTrendChart({
  days,
  impressionBased,
}: {
  days: TrendDay[];
  impressionBased: boolean;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const metrics = visibleTrendMetrics(days, impressionBased);
  const [metric, setMetric] = useState<TrendMetric>(
    metrics.includes("interactions")
      ? "interactions"
      : (metrics[0] ?? "postCount"),
  );
  const active = metrics.includes(metric)
    ? metric
    : (metrics[0] ?? "postCount");
  const points = days.map((day) => ({
    date: dayKey(day.date),
    value: active === "postCount" ? day.postCount : day[active],
  }));

  function label(value: TrendMetric) {
    return value === "interactions"
      ? t("performance.interactions")
      : value === "postCount"
        ? t("performance.posts")
        : t(`metrics.${value}`);
  }

  return (
    <section
      className="bg-card min-w-0 space-y-4 rounded-xl border p-6"
      aria-labelledby="trends-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="trends-heading" className="text-base font-semibold">
          {t("performance.trends")}
        </h2>
        <div className="space-y-1">
          <Label className="sr-only" htmlFor="performance-trend-metric">
            {t("performance.trendMetric")}
          </Label>
          <Select
            value={active}
            onValueChange={(value) => {
              if (
                value === "interactions" ||
                value === "views" ||
                value === "impressions" ||
                value === "postCount"
              )
                setMetric(value);
            }}
          >
            <SelectTrigger
              className="h-11 md:h-10 data-[size=default]:h-11 md:data-[size=default]:h-10"
              id="performance-trend-metric"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {metrics.map((option) => (
                <SelectItem key={option} value={option}>
                  {label(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DailyBarChart
        label={label(active)}
        points={points}
        unavailable={t("unavailable")}
      />
    </section>
  );
}
