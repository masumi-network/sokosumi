"use client";

import type { SocialPerformanceResponse } from "@sokosumi/core-client";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
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
import { MetricSparkline, PostingConsistency } from "./posting-consistency";

type TrendMetric = "interactions" | "impressions" | "views" | "postCount";

function calendarDay(value: string | Date): string {
  const day = typeof value === "string" ? value : value.toISOString();
  return day.slice(0, 10);
}

interface TrendPoint {
  date: string | Date;
  value: number | null;
}

function TrendChart({
  points,
  label,
}: {
  points: TrendPoint[];
  label: string;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const peak = Math.max(0, ...points.map((point) => point.value ?? 0));
  function dateLabel(date: string | Date) {
    const day = (typeof date === "string" ? date : date.toISOString()).slice(
      0,
      10,
    );
    return format.dateTime(new Date(`${day}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return (
    <figure className="min-w-0 space-y-3" aria-label={label}>
      <div className="flex h-40 items-end gap-px border-b" aria-hidden="true">
        {points.map((point) => (
          <div
            key={
              typeof point.date === "string"
                ? point.date
                : point.date.toISOString()
            }
            className="flex h-full min-w-0 flex-1 items-end"
            title={`${dateLabel(point.date)}: ${point.value == null ? t("unavailable") : format.number(point.value)}`}
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
        <span>{points[0] ? dateLabel(points[0].date) : t("unavailable")}</span>
        <span>{points.at(-1) ? dateLabel(points.at(-1)?.date ?? "") : ""}</span>
      </div>
    </figure>
  );
}

export function SocialPerformanceOverview({
  data,
}: {
  data: SocialPerformanceResponse;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("interactions");
  const current = data.summary.current;
  const accountProvider =
    data.accounts.length === 1 ? data.accounts[0]?.provider : null;
  const impressionBased =
    accountProvider === "x" || accountProvider === "linkedin";
  function number(value: number | null, compact = false) {
    return value == null
      ? "—"
      : format.number(
          value,
          compact && Math.abs(value) >= 10000
            ? { notation: "compact", maximumFractionDigits: 1 }
            : { maximumFractionDigits: 2 },
        );
  }
  const cards = [
    {
      key: "postCount",
      label: t("performance.posts"),
      value: current.postCount,
      measured: current.postCount,
    },
    {
      key: "views",
      label: t("metrics.views"),
      value: current.metrics.views.total,
      measured: current.metrics.views.measuredPostCount,
    },
    {
      key: "impressions",
      label: t("metrics.impressions"),
      value: current.metrics.impressions.total,
      measured: current.metrics.impressions.measuredPostCount,
    },
    {
      key: "interactions",
      label: t("performance.interactions"),
      value: current.interactions.total,
      measured: current.interactions.measuredPostCount,
    },
  ] as const;
  const visibleCards = cards.filter(
    (card) =>
      !accountProvider ||
      (card.key !== "views" && card.key !== "impressions") ||
      card.measured > 0 ||
      (card.key === "impressions" ? impressionBased : !impressionBased),
  );
  const activeTrendMetric = visibleCards.some(
    (card) => card.key === trendMetric,
  )
    ? trendMetric
    : "interactions";
  return (
    <div className="space-y-8" data-testid="social-performance-overview">
      <section aria-labelledby="key-metrics-heading">
        <h2 id="key-metrics-heading" className="sr-only">
          {t("performance.keyMetrics")}
        </h2>
        <div
          className={cn(
            "grid grid-cols-2 gap-x-3 gap-y-4 xl:gap-6",
            visibleCards.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
          )}
        >
          {visibleCards.map((card) => {
            const delta = data.summary.deltas[card.key];
            return (
              <article key={card.key} className="flex min-w-0 flex-col">
                <p className="text-muted-foreground mb-1 text-sm">
                  {card.label}
                </p>
                <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <p
                    className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl"
                    title={
                      card.value == null
                        ? t("unavailable")
                        : format.number(card.value)
                    }
                  >
                    {number(card.value, true)}
                  </p>
                  {delta != null ? (
                    <span
                      className={cn(
                        "flex items-center gap-0.5 text-xs font-medium whitespace-nowrap tabular-nums sm:gap-1 sm:text-base",
                        delta >= 0
                          ? "text-semantic-success"
                          : "text-semantic-destructive",
                      )}
                      title={t("performance.previousPeriod")}
                    >
                      {delta >= 0 ? (
                        <ArrowUpRight
                          className="size-3 sm:size-4"
                          aria-hidden
                        />
                      ) : (
                        <ArrowDownRight
                          className="size-3 sm:size-4"
                          aria-hidden
                        />
                      )}
                      {format.number(delta, {
                        signDisplay: "always",
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="mt-auto">
                  <MetricSparkline
                    label={t("performance.sparkline", { metric: card.label })}
                    values={data.daily.map((day) =>
                      card.key === "postCount"
                        ? day.summary.postCount
                        : card.key === "views"
                          ? day.summary.metrics.views.total
                          : card.key === "impressions"
                            ? day.summary.metrics.impressions.total
                            : day.summary.interactions.total,
                    )}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <PostingConsistency
        days={data.consistency.daily.map((day) => ({
          date: calendarDay(day.date),
          posts: day.postCount,
          engagement: day.interactions,
        }))}
        selectedFrom={calendarDay(data.consistency.selectedFrom)}
        selectedUntil={calendarDay(data.consistency.selectedUntil)}
      />
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
              value={activeTrendMetric}
              onValueChange={(value) => {
                if (
                  value === "interactions" ||
                  value === "views" ||
                  value === "impressions" ||
                  value === "postCount"
                )
                  setTrendMetric(value);
              }}
            >
              <SelectTrigger id="performance-trend-metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["interactions", "impressions", "views", "postCount"] as const
                )
                  .filter((metric) =>
                    visibleCards.some((card) => card.key === metric),
                  )
                  .map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {metric === "interactions"
                        ? t("performance.interactions")
                        : metric === "postCount"
                          ? t("performance.posts")
                          : t(`metrics.${metric}`)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <TrendChart
          label={
            activeTrendMetric === "interactions"
              ? t("performance.interactions")
              : activeTrendMetric === "postCount"
                ? t("performance.posts")
                : t(`metrics.${activeTrendMetric}`)
          }
          points={data.daily.map((day) => ({
            date: day.date,
            value:
              activeTrendMetric === "postCount"
                ? day.summary.postCount
                : activeTrendMetric === "interactions"
                  ? day.summary.interactions.total
                  : day.summary.metrics[activeTrendMetric].total,
          }))}
        />
      </section>
    </div>
  );
}
