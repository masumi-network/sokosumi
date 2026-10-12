"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
  const format = useFormatter();
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
  const peak = Math.max(0, ...points.map((point) => point.value ?? 0));

  function label(value: TrendMetric) {
    return value === "interactions"
      ? t("performance.interactions")
      : value === "postCount"
        ? t("performance.posts")
        : t(`metrics.${value}`);
  }

  function dateLabel(date: string) {
    return format.dateTime(new Date(`${date}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
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
            <SelectTrigger id="performance-trend-metric">
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
      <figure className="min-w-0 space-y-3" aria-label={label(active)}>
        <div className="flex h-40 items-end gap-px border-b" aria-hidden="true">
          {points.map((point) => (
            <div
              key={point.date}
              className="flex h-full min-w-0 flex-1 items-end"
              title={`${dateLabel(point.date)}: ${
                point.value == null
                  ? t("unavailable")
                  : format.number(point.value)
              }`}
            >
              <div
                className={cn(
                  "w-full rounded-t-sm",
                  point.value == null
                    ? "border-border h-2 border border-dashed"
                    : point.value === 0
                      ? "bg-border h-px"
                      : "bg-chart-1",
                )}
                style={
                  point.value == null || point.value === 0
                    ? undefined
                    : {
                        height: `${Math.max(2, peak ? (point.value / peak) * 100 : 0)}%`,
                      }
                }
              />
            </div>
          ))}
        </div>
        <div className="text-muted-foreground flex justify-between gap-3 text-xs">
          <span>
            {points[0] ? dateLabel(points[0].date) : t("unavailable")}
          </span>
          <span>
            {points.at(-1) ? dateLabel(points.at(-1)?.date ?? "") : ""}
          </span>
        </div>
      </figure>
    </section>
  );
}
