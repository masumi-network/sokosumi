"use client";

import type {
  SocialPerformanceResponse,
  SocialPerformanceSummary,
  WorkspaceSocialPerformanceResponse,
} from "@sokosumi/core-client";
import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MetricSparkline, PostingConsistency } from "./posting-consistency";
import { ACCOUNT_METRIC_LABELS } from "./social-post-metrics";

type TrendMetric = "interactions" | "impressions" | "views" | "postCount";

interface TrendPoint {
  date: string | Date;
  value: number | null;
}

/** Exact values remain keyboard-accessible in a native disclosure below each chart. */
function TrendChart({
  points,
  label,
  timezone,
}: {
  points: TrendPoint[];
  label: string;
  timezone: string;
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
      <details className="group">
        <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-3.5 group-open:rotate-180" aria-hidden />
          {t("performance.exactValues")}
        </summary>
        <Table className="mt-2">
          <caption className="sr-only">
            {label} · {timezone}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("performance.date")}</TableHead>
              <TableHead className="text-end">{label}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow
                key={
                  typeof point.date === "string"
                    ? point.date
                    : point.date.toISOString()
                }
              >
                <TableCell>{dateLabel(point.date)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {point.value == null
                    ? t("unavailable")
                    : format.number(point.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}

export function SocialPerformanceOverview({
  data,
  projects = [],
  projectComparisons,
}: {
  data: SocialPerformanceResponse;
  projects?: WorkspaceSocialPerformanceResponse["projects"];
  projectComparisons?: WorkspaceSocialPerformanceResponse["comparisons"]["projects"];
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("interactions");
  const current = data.summary.current;
  const accountProvider =
    data.accounts.length === 1 ? data.accounts[0]?.provider : null;
  const impressionBased =
    accountProvider === "x" || accountProvider === "linkedin";
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  function accountName(id: string) {
    const account = accountsById.get(id);
    return account?.displayName ?? account?.externalHandle ?? t("account");
  }
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
  function rate(summary: SocialPerformanceSummary) {
    const rates = summary.engagementRates.filter((item) => item.rate != null);
    return rates.length === 1 ? `${number(rates[0]?.rate ?? null)}%` : "—";
  }
  const cards = [
    {
      key: "postCount",
      label: t("performance.posts"),
      value: current.postCount,
      mean: null,
      median: null,
      measured: current.postCount,
    },
    {
      key: "views",
      label: t("metrics.views"),
      value: current.metrics.views.total,
      mean: current.metrics.views.mean,
      median: current.metrics.views.median,
      measured: current.metrics.views.measuredPostCount,
    },
    {
      key: "impressions",
      label: t("metrics.impressions"),
      value: current.metrics.impressions.total,
      mean: current.metrics.impressions.mean,
      median: current.metrics.impressions.median,
      measured: current.metrics.impressions.measuredPostCount,
    },
    {
      key: "interactions",
      label: t("performance.interactions"),
      value: current.interactions.total,
      mean: current.interactions.mean,
      median: current.interactions.median,
      measured: current.interactions.measuredPostCount,
    },
  ] as const;
  const cellsByTime = new Map(
    data.heatmap.cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]),
  );
  const rankedWindows = data.heatmap.comparisonProvider
    ? data.heatmap.cells
        .filter(
          (cell) =>
            cell.measuredPostCount >= data.heatmap.minimumSampleSize &&
            cell.meanInteractions != null,
        )
        .toSorted(
          (a, b) =>
            (b.meanInteractions ?? 0) - (a.meanInteractions ?? 0) ||
            b.measuredPostCount - a.measuredPostCount ||
            a.weekday - b.weekday ||
            a.hour - b.hour,
        )
        .slice(0, 3)
    : [];
  const peakInteractions = Math.max(
    0,
    ...data.heatmap.cells.map((cell) =>
      data.heatmap.comparisonProvider
        ? (cell.meanInteractions ?? 0)
        : cell.postCount,
    ),
  );
  const weekdayDates = Array.from(
    { length: 7 },
    (_, day) => new Date(Date.UTC(2026, 0, 5 + day, 12)),
  );
  function heatCell(weekday: number, hour: number) {
    const cell = cellsByTime.get(`${weekday}:${hour}`);
    const value = data.heatmap.comparisonProvider
      ? cell?.meanInteractions
      : cell?.postCount;
    const tier =
      value == null || peakInteractions === 0 ? 0 : value / peakInteractions;
    return (
      <td key={hour} className="p-0.5">
        <div
          title={t(
            data.heatmap.comparisonProvider
              ? "performance.heatmapCell"
              : "performance.heatmapActivityCell",
            {
              day: format.dateTime(weekdayDates[weekday] ?? new Date(0), {
                weekday: "long",
                timeZone: "UTC",
              }),
              hour: format.number(hour),
              count: cell?.postCount ?? 0,
              value: value == null ? t("unavailable") : number(value),
            },
          )}
          className={cn(
            "flex size-6 items-center justify-center rounded-sm text-2xs tabular-nums",
            tier > 0.66
              ? "bg-chart-1 text-foreground"
              : tier > 0.33
                ? "bg-chart-1-quinary text-foreground"
                : "bg-muted text-muted-foreground",
            !cell?.postCount && "border border-dashed",
          )}
        >
          <span className="sr-only">
            {t(
              data.heatmap.comparisonProvider
                ? "performance.heatmapCell"
                : "performance.heatmapActivityCell",
              {
                day: format.dateTime(weekdayDates[weekday] ?? new Date(0), {
                  weekday: "long",
                  timeZone: "UTC",
                }),
                hour: format.number(hour),
                count: cell?.postCount ?? 0,
                value: value == null ? t("unavailable") : number(value),
              },
            )}
          </span>
        </div>
      </td>
    );
  }
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
  const comparisonGroups = [
    ...(projectComparisons && data.accounts.length > 1
      ? [
          {
            key: "projects",
            title: t("performance.projectComparison"),
            rows: projectComparisons.map((item) => ({
              id: item.projectId,
              name:
                projects.find((project) => project.id === item.projectId)
                  ?.name ?? t("performance.project"),
              provider: null,
              summary: item.summary,
            })),
          },
        ]
      : []),
    ...(data.accounts.length > 1
      ? [
          {
            key: "accounts",
            title: t("performance.accountComparison"),
            rows: data.comparisons.accounts.map((item) => ({
              id: item.connectionId,
              name: accountName(item.connectionId),
              provider: item.provider,
              summary: item.summary,
            })),
          },
        ]
      : []),
    {
      key: "formats",
      title: t("performance.formatComparison"),
      rows: data.comparisons.formats.map((item) => ({
        id: item.contentType,
        name: t(`performance.formats.${item.contentType}`),
        provider: null,
        summary: item.summary,
      })),
    },
  ];
  return (
    <div className="space-y-8" data-testid="social-performance-overview">
      {/* Hero metrics - no borders, prominent deltas */}
      <section aria-labelledby="key-metrics-heading">
        <h2 id="key-metrics-heading" className="sr-only">
          {t("performance.keyMetrics")}
        </h2>
        <div
          className={cn(
            "grid gap-6 sm:grid-cols-2",
            visibleCards.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
          )}
        >
          {visibleCards.map((card) => {
            const delta = data.summary.deltas[card.key];
            const hasCoverage = card.key !== "postCount" && card.measured > 0;
            const coverageDetails = hasCoverage
              ? t("performance.detailsAvailable", {
                  mean: number(card.mean),
                  median: number(card.median),
                  measured: card.measured,
                  total: current.postCount,
                })
              : null;
            return (
              <article
                key={card.key}
                className="min-w-0"
                title={coverageDetails ?? undefined}
              >
                <p className="text-muted-foreground mb-2 text-sm">
                  {card.label}
                </p>
                <div className="flex items-baseline gap-3">
                  <p
                    className="text-4xl font-semibold tracking-tight tabular-nums"
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
                        "flex items-center gap-1 text-base font-medium tabular-nums",
                        delta >= 0
                          ? "text-semantic-success"
                          : "text-semantic-destructive",
                      )}
                      title={t("performance.previousPeriod")}
                    >
                      {delta >= 0 ? (
                        <ArrowUpRight className="size-4" aria-hidden />
                      ) : (
                        <ArrowDownRight className="size-4" aria-hidden />
                      )}
                      {format.number(delta, {
                        signDisplay: "always",
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : null}
                </div>
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
                {hasCoverage ? (
                  <details className="group mt-2">
                    <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                      <ChevronDown
                        className="size-3 group-open:rotate-180"
                        aria-hidden
                      />
                      {t("performance.details")}
                    </summary>
                    <dl className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                      <div className="flex justify-between gap-3">
                        <dt>{t("performance.mean")}:</dt>
                        <dd className="tabular-nums">{number(card.mean)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>{t("performance.median")}:</dt>
                        <dd className="tabular-nums">{number(card.median)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>
                          {t("performance.metricCoverage", {
                            measured: card.measured,
                            total: current.postCount,
                          })}
                        </dt>
                      </div>
                    </dl>
                  </details>
                ) : (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("performance.previousPeriod")}
                  </p>
                )}
              </article>
            );
          })}
        </div>
        {/* Data quality note - contextual, not prominent */}
        <details className="group mt-4">
          <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3 group-open:rotate-180" aria-hidden />
            {t("performance.aboutThisData")}
          </summary>
          <div className="text-muted-foreground mt-2 space-y-1 text-xs">
            <p>{t("performance.cohortHint")}</p>
            <p>
              {t("performance.coverage", {
                count: current.measuredPostCount,
                total: current.postCount,
              })}
              {data.coverage.lastFetchedAt
                ? ` · ${t("updatedAt", { date: format.dateTime(new Date(data.coverage.lastFetchedAt), "dateTime", { timeZone: data.range.timezone, timeZoneName: "short" }) })}`
                : ""}
            </p>
            {!data.coverage.historyComplete ? (
              <p>{t("performance.partialHistory")}</p>
            ) : null}
            {current.postCount < data.heatmap.minimumSampleSize ? (
              <p>
                {t("performance.thinData", {
                  count: data.heatmap.minimumSampleSize,
                })}
              </p>
            ) : null}
            {data.coverage.missingPublicationDateCount ? (
              <p>
                {t("performance.missingDates", {
                  count: data.coverage.missingPublicationDateCount,
                })}
              </p>
            ) : null}
          </div>
        </details>
      </section>
      <PostingConsistency
        days={data.daily.map((day) => ({
          date: (typeof day.date === "string"
            ? day.date
            : day.date.toISOString()
          ).slice(0, 10),
          posts: day.summary.postCount,
          engagement: day.summary.interactions.total,
        }))}
      />
      {/* Trend section - always visible, streamlined */}
      <section
        className="bg-card min-w-0 space-y-4 rounded-xl border p-6"
        aria-labelledby="trends-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="trends-heading" className="text-base font-semibold">
              {t("performance.trends")}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {t("performance.trendsHint", { timezone: data.range.timezone })}
            </p>
          </div>
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
          timezone={data.range.timezone}
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
      {/* Advanced insights - progressive disclosure */}
      <details className="group/insights min-w-0">
        <summary className="bg-card hover:bg-card-background-hover flex cursor-pointer list-none items-center gap-2 rounded-xl border p-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="size-4 group-open/insights:rotate-180"
            aria-hidden
          />
          {t("performance.moreInsights")}
        </summary>
        <div className="mt-6 min-w-0 space-y-6">
          <section className="bg-card min-w-0 space-y-4 rounded-xl border p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                {t("performance.postingTimes")}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t("performance.postingTimesHint", {
                  timezone: data.heatmap.timezone,
                })}
              </p>
            </div>
            <div className="app-scrollbar relative overflow-x-auto pb-2">
              <table className="w-max border-separate border-spacing-0 text-xs">
                <caption className="sr-only">
                  {t("performance.postingTimes")}
                </caption>
                <thead>
                  <tr>
                    <th className="pe-2 text-start">
                      {t("performance.dayHour")}
                    </th>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <th
                        key={hour}
                        className="text-muted-foreground text-2xs font-normal"
                      >
                        {hour % 3 === 0 ? (
                          format.number(hour)
                        ) : (
                          <span className="sr-only">{format.number(hour)}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekdayDates.map((date, weekday) => (
                    <tr key={date.toISOString()}>
                      <th
                        scope="row"
                        className="text-muted-foreground pe-2 text-start font-normal"
                      >
                        {format.dateTime(date, {
                          weekday: "short",
                          timeZone: "UTC",
                        })}
                      </th>
                      {Array.from({ length: 24 }, (_, hour) =>
                        heatCell(weekday, hour),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.heatmap.comparisonProvider ? (
              <p className="text-muted-foreground text-xs">
                {t("performance.activityOnly")}
              </p>
            ) : null}
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="size-3.5 group-open:rotate-180"
                  aria-hidden
                />
                {t("performance.exactValues")}
              </summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("performance.dayHour")}</TableHead>
                    <TableHead className="text-end">
                      {t("performance.posts")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("performance.mean")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.heatmap.cells
                    .filter((cell) => cell.postCount > 0)
                    .map((cell) => (
                      <TableRow key={`${cell.weekday}:${cell.hour}`}>
                        <TableCell>
                          {format.dateTime(
                            weekdayDates[cell.weekday] ?? new Date(0),
                            { weekday: "short", timeZone: "UTC" },
                          )}{" "}
                          {format.number(cell.hour)}:00
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(cell.postCount)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {number(cell.meanInteractions)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </details>
            <p className="text-muted-foreground text-xs">
              {t("performance.heatmapHint", {
                count: data.heatmap.minimumSampleSize,
              })}
            </p>
            <div className="space-y-2 border-t pt-3">
              <h4 className="text-xs font-medium">
                {t("performance.rankedWindows")}
              </h4>
              <p className="text-muted-foreground text-xs">
                {t("performance.rankedWindowsHint", {
                  count: data.heatmap.minimumSampleSize,
                  timezone: data.heatmap.timezone,
                })}
              </p>
              {rankedWindows.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("performance.dayHour")}</TableHead>
                      <TableHead className="text-end">
                        {t("performance.measuredPosts")}
                      </TableHead>
                      <TableHead className="text-end">
                        {t("performance.meanInteractions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedWindows.map((cell) => (
                      <TableRow key={`${cell.weekday}:${cell.hour}`}>
                        <TableCell>
                          {format.dateTime(
                            weekdayDates[cell.weekday] ?? new Date(0),
                            { weekday: "short", timeZone: "UTC" },
                          )}{" "}
                          {format.number(cell.hour)}:00
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(cell.measuredPostCount)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {number(cell.meanInteractions)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {t("performance.noRankedWindows")}
                </p>
              )}
            </div>
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">
              {t(
                accountProvider
                  ? "performance.engagementRate"
                  : "performance.engagementRates",
              )}
            </h3>
            <p className="text-muted-foreground text-xs">
              {t("performance.ratesHint")}
            </p>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!accountProvider ? (
                      <TableHead>{t("platform")}</TableHead>
                    ) : null}
                    <TableHead>{t("performance.rateFormula")}</TableHead>
                    <TableHead className="text-end">
                      {t("performance.engagementRate")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("performance.mean")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("performance.median")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("performance.measuredPosts")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.engagementRates.map((item) => (
                    <TableRow key={`${item.provider}-${item.denominator}`}>
                      {!accountProvider ? (
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <SocialPostProviderIcon
                              className="size-4"
                              provider={item.provider}
                              aria-hidden
                            />
                            {SOCIAL_PROVIDERS.find(
                              (provider) => provider.id === item.provider,
                            )?.name ?? item.provider}
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell className="text-muted-foreground max-w-64 whitespace-normal text-xs">
                        {item.numeratorMetrics
                          .map((metric) =>
                            metric === "quotes" || metric === "quote_count"
                              ? t("accountMetrics.quotes")
                              : t.has(`metrics.${metric}`)
                                ? t(`metrics.${metric}`)
                                : ACCOUNT_METRIC_LABELS[metric] &&
                                    t.has(
                                      `accountMetrics.${ACCOUNT_METRIC_LABELS[metric]}`,
                                    )
                                  ? t(
                                      `accountMetrics.${ACCOUNT_METRIC_LABELS[metric]}`,
                                    )
                                  : metric,
                          )
                          .join(" + ")}{" "}
                        / {t(`metrics.${item.denominator}`)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {item.rate == null
                          ? t("unavailable")
                          : `${number(item.rate)}%`}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {item.mean == null ? "—" : `${number(item.mean)}%`}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {item.median == null ? "—" : `${number(item.median)}%`}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {format.number(item.measuredPostCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {comparisonGroups.map((group) => (
              <section key={group.key} className="min-w-0 space-y-3">
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {group.key === "accounts"
                            ? t("account")
                            : group.key === "projects"
                              ? t("performance.project")
                              : t("performance.contentType")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("performance.posts")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("performance.mean")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("performance.median")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("performance.engagementRate")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-48 whitespace-normal">
                            <span className="flex items-center gap-2">
                              {item.provider ? (
                                <SocialPostProviderIcon
                                  className="size-4 shrink-0"
                                  provider={item.provider}
                                  aria-hidden
                                />
                              ) : null}
                              {item.name}
                            </span>
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {format.number(item.summary.postCount)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {number(item.summary.interactions.mean)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {number(item.summary.interactions.median)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {rate(item.summary)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("performance.comparisonHint")}
                </p>
              </section>
            ))}
          </div>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("performance.growth")}</h3>
            <p className="text-muted-foreground text-xs">
              {t("performance.growthHint")}
            </p>
            {data.followers.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {data.followers.map((item) => (
                  <article
                    key={item.connectionId}
                    className="bg-card min-w-0 space-y-4 rounded-xl border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h4 className="flex items-center gap-2 text-sm font-medium">
                        <SocialPostProviderIcon
                          className="size-4"
                          provider={item.provider}
                          aria-hidden
                        />
                        {accountName(item.connectionId)}
                      </h4>
                      <span className="text-sm tabular-nums">
                        {item.change == null
                          ? t("performance.baselineNeeded")
                          : format.number(item.change, {
                              signDisplay: "always",
                            })}
                      </span>
                    </div>
                    <TrendChart
                      label={t("accountMetrics.followers")}
                      timezone={data.range.timezone}
                      points={item.points.map((point) => ({
                        date: point.date,
                        value: point.value,
                      }))}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
                {t("performance.baselineNeeded")}
              </p>
            )}
            <details className="group rounded-xl border p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="size-4 group-open:rotate-180"
                  aria-hidden
                />
                {t("performance.observations")}
              </summary>
              <p className="text-muted-foreground mt-3 text-xs">
                {t("performance.observationsHint")}
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {data.accounts.map((account) => {
                  const points = data.observations
                    .filter(
                      (observation) => observation.connectionId === account.id,
                    )
                    .map((observation) => ({
                      date: observation.date,
                      value: observation.summary.interactions.total,
                    }));
                  return points.length ? (
                    <div key={account.id} className="min-w-0 space-y-3">
                      <h4 className="text-sm font-medium">
                        {accountName(account.id)}
                      </h4>
                      <TrendChart
                        label={t("performance.interactions")}
                        timezone={data.range.timezone}
                        points={points}
                      />
                    </div>
                  ) : null;
                })}
              </div>
              {!data.coverage.historicalSnapshotsAvailable ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  {t("performance.baselineNeeded")}
                </p>
              ) : null}
            </details>
          </section>
        </div>
      </details>
    </div>
  );
}
