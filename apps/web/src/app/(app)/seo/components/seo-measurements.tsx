"use client";

import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { ArrowDown, ArrowUp, Plug, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  SEO_MIN_COMPARE_IMPRESSIONS,
  seoPeriodChange,
  seoShownValue,
  seoWeekOverWeek,
} from "./seo-performance-model";
import {
  SEO_CHOSEN_CLASS,
  SeoDate,
  SeoPeriod,
  SeoSection,
  SeoState,
} from "./seo-shared";
import {
  latestSeoMeasurements,
  seoChangeMarkers,
  seoCoverageIsNews,
  seoDefaultMetric,
  seoReportedPeriod,
} from "./seo-statistics-model";
import { SeoTrendChart } from "./seo-trend-chart";
import { useSearchConsoleConnected } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Measured traffic for the selected pages: totals, the newest 7 reported days against the 7 before, and the daily trend. */
export function SeoMeasurements({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const positionHintId = useId();
  const workspace = model.data;
  const metrics = latestSeoMeasurements(workspace.metrics);
  const providers = [...new Set(metrics.map((metric) => metric.source))];
  const [chosenProvider, setProvider] = useState("");
  const [chosenMetric, setMetric] = useState("");
  const provider = providers.includes(chosenProvider)
    ? chosenProvider
    : providers[0];
  const visible = metrics.filter((metric) => metric.source === provider);
  const active =
    visible.find((metric) => metric.id === chosenMetric) ??
    seoDefaultMetric(visible);
  const compared = seoWeekOverWeek(visible);
  const periodChanges = seoPeriodChange(visible);
  // Google reports a few days late, so the period ends on the last reported day. It starts where the
  // read starts, because Google leaves quiet days out; the agent card and search queries do the same.
  const reported = seoReportedPeriod(visible);
  const canSync = workspace.availableActions.canSyncMetrics;
  // Only the empty card asks: a connected account with nothing synced needs a sync, not a connection.
  const connected = useSearchConsoleConnected(!active);
  function label(metric: ProjectSeoMetric) {
    return t.has(`metrics.${metric.key}`)
      ? t(`metrics.${metric.key}`)
      : metric.label;
  }
  function measuredValue(
    value: number,
    unit: ProjectSeoMetric["unit"],
    signDisplay: "auto" | "exceptZero" = "auto",
  ) {
    return unit === "ratio"
      ? format.number(value, {
          style: "percent",
          maximumFractionDigits: 1,
          signDisplay,
        })
      : format.number(value, {
          // Position always shows one decimal, so 1.0 and 3.8 read alike.
          minimumFractionDigits: unit === "position" ? 1 : 0,
          maximumFractionDigits: unit === "count" ? 0 : 1,
          signDisplay,
        });
  }
  const weekImpressions = compared?.values.impressions;
  // A rate or an average over a handful of impressions moves at random from week to week.
  const enoughImpressions =
    (weekImpressions?.current ?? 0) >= SEO_MIN_COMPARE_IMPRESSIONS &&
    (weekImpressions?.previous ?? 0) >= SEO_MIN_COMPARE_IMPRESSIONS;
  // Both weeks measured but too small: one note under the tiles says so for the rate and the position.
  const tooFew =
    weekImpressions?.current != null &&
    weekImpressions.previous != null &&
    !enoughImpressions;
  // Both weeks under the floor: no week line on any tile, one note gives the two counts.
  const quietWeeks =
    tooFew &&
    Math.max(weekImpressions.current ?? 0, weekImpressions.previous ?? 0) <
      SEO_MIN_COMPARE_IMPRESSIONS;
  const isRate = (key: string) => key === "ctr" || key === "position";
  // The rate tiles on show whose weeks are too small; the note names only these.
  const quietRates =
    tooFew && !quietWeeks
      ? visible
          .filter(
            (metric) => isRate(metric.key) && compared?.values[metric.key],
          )
          .map((metric) => metric.key)
      : [];
  /** The last 7 days against the 7 before, with both values shown. A lower position is better. */
  function change(
    key: string,
    week: { current: number | null; previous: number | null },
    unit: ProjectSeoMetric["unit"],
  ) {
    if (week.current === null || week.previous === null) return null;
    // Unmeasured impressions are not "too few"; the comparison is just missing.
    if (isRate(key) && !enoughImpressions)
      return { text: t("overview.noComparison"), Icon: null, muted: true };
    // Judge the change between the values as shown: equal shown values are no change.
    const scale = 10 ** (unit === "count" ? 0 : unit === "ratio" ? 3 : 1);
    const shown = (value: number) => Math.round(value * scale) / scale;
    const delta = shown(shown(week.current) - shown(week.previous));
    const values = {
      period: compared ? windowLabel(compared.current) : "",
      current: measuredValue(week.current, unit),
      previous: measuredValue(week.previous, unit),
    };
    // An arrow up next to a falling position reads as worse; the position says it in words.
    if (unit === "position" && delta !== 0)
      return {
        text: t(
          delta < 0 ? "overview.weekBetter" : "overview.weekWorse",
          values,
        ),
        Icon: null,
        muted: false,
      };
    // An arrow needs one busy week: a collapse or a launch is a real change.
    const trend =
      !weekImpressions ||
      Math.max(weekImpressions.current ?? 0, weekImpressions.previous ?? 0) >=
        SEO_MIN_COMPARE_IMPRESSIONS;
    return {
      text: t("overview.weekCompare", values),
      Icon:
        unit === "position" || delta === 0 || !trend
          ? null
          : delta > 0
            ? ArrowUp
            : ArrowDown,
      muted: false,
    };
  }
  /** The period total against the equal window before it. A lower position is better. */
  function periodChange(metric: ProjectSeoMetric) {
    const before = periodChanges.get(metric.id);
    if (!before || metric.value === null) return null;
    const shown = (value: number) => seoShownValue(value, metric.unit);
    const delta = shown(shown(metric.value) - shown(before.previous));
    const values = {
      days: before.days,
      previous: measuredValue(before.previous, metric.unit),
      // A rate change is in percentage points: 2% to 3% is +1 point, not +1%.
      change:
        metric.unit === "ratio"
          ? t("overview.points", {
              value: format.number(delta * 100, {
                maximumFractionDigits: 1,
                signDisplay: "exceptZero",
              }),
            })
          : measuredValue(delta, metric.unit, "exceptZero"),
    };
    if (delta === 0) return t("overview.periodSame", values);
    if (metric.unit === "position")
      return t(
        delta < 0 ? "overview.periodBetter" : "overview.periodWorse",
        values,
      );
    return t("overview.periodCompare", values);
  }
  function value(metric: ProjectSeoMetric) {
    return metric.value === null || metric.coverage === "unavailable"
      ? t("none")
      : measuredValue(metric.value, metric.unit);
  }
  function windowLabel(window: { from: string; to: string }) {
    return format.dateTimeRange(
      new Date(`${window.from}T00:00:00Z`),
      new Date(`${window.to}T00:00:00Z`),
      { month: "short", day: "numeric", timeZone: "UTC" },
    );
  }
  // Sync sits in the header next to the date it changes, as on Keywords.
  const syncButton = !active ? null : canSync &&
    active.source === "search_console" ? (
    <Button
      variant="outline"
      size="sm"
      loading={model.pending}
      onClick={() => {
        void model.refreshSearchStatistics(active);
      }}
    >
      <RefreshCw />
      {t("syncNow")}
    </Button>
  ) : canSync ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        model.openStatistics(
          active.source === "ga4" || active.source === "search_console"
            ? active.source
            : undefined,
        )
      }
    >
      <RefreshCw />
      {t("syncStatistics")}
    </Button>
  ) : null;
  return (
    <SeoSection
      title={t("overview.measurements")}
      description={
        active ? (
          <>
            {t(`statistics.${active.source}`)} ·{" "}
            <SeoPeriod from={active.from} to={reported?.to ?? active.to} />
            {/* Search Console only counts Google search, so its channel says nothing. */}
            {active.source === "search_console"
              ? null
              : ` · ${t(
                  active.channel === "organic"
                    ? "statistics.channelOrganic"
                    : "statistics.channelAll",
                )}`}
            {" · "}
            {t("overview.synced")} <SeoDate value={active.observedAt} />
          </>
        ) : undefined
      }
      actions={
        active && providers.length > 1 ? (
          <div className="flex flex-wrap items-end gap-2">
            <SeoField
              id="seo-performance-source"
              label={t("statistics.provider")}
            >
              <SeoSelect
                id="seo-performance-source"
                value={provider}
                onValueChange={setProvider}
                options={providers.map((source) => ({
                  value: source,
                  label: t(`statistics.${source}`),
                }))}
              />
            </SeoField>
            {syncButton}
          </div>
        ) : (
          (syncButton ?? undefined)
        )
      }
    >
      {active ? (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-5 p-4 sm:p-5")}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {visible.map((metric) => {
              const week =
                quietWeeks || (tooFew && isRate(metric.key))
                  ? null
                  : (compared?.values[metric.key] ?? null);
              const moved = week ? change(metric.key, week, metric.unit) : null;
              const sincePeriod = periodChange(metric);
              return (
                <Button
                  key={metric.id}
                  variant="outline"
                  type="button"
                  aria-pressed={active.id === metric.id}
                  aria-describedby={
                    metric.unit === "position" ? positionHintId : undefined
                  }
                  className={cn(
                    "h-auto min-w-0 flex-col items-start justify-start gap-1 px-3 py-3 text-start whitespace-normal",
                    active.id === metric.id && SEO_CHOSEN_CLASS,
                  )}
                  onClick={() => setMetric(metric.id)}
                >
                  <span className="text-muted-foreground flex items-center gap-2 text-xs font-normal max-sm:min-h-[2lh] max-sm:items-start">
                    {/* Every tile carries the line marker, so each one reads as a chart choice. */}
                    <span
                      aria-hidden
                      className={cn(
                        "h-0.5 w-3 shrink-0 rounded-full max-sm:mt-[7px]",
                        active.id === metric.id
                          ? "bg-foreground"
                          : "bg-chart-5",
                      )}
                    />
                    {label(metric)}
                  </span>
                  <span
                    className="text-2xl font-semibold"
                    data-testid={`seo-metric-${metric.key}`}
                  >
                    {value(metric)}
                  </span>
                  {/* A position reads backwards to most people: a smaller number is better. */}
                  {metric.unit === "position" ? (
                    // Hidden from the name, so "4.2" and "1" do not read as one number; it describes the tile.
                    <span
                      id={positionHintId}
                      aria-hidden
                      className="text-muted-foreground text-xs font-normal"
                    >
                      {t("overview.positionHint")}
                    </span>
                  ) : null}
                  {/* One comparison line; "About this data" names both weeks. */}
                  {week ? (
                    moved ? (
                      <span
                        className={cn(
                          "flex items-center gap-1 text-xs",
                          moved.muted
                            ? "text-muted-foreground font-normal"
                            : "font-medium",
                        )}
                      >
                        {moved.Icon ? (
                          <moved.Icon className="size-3 shrink-0" aria-hidden />
                        ) : null}
                        {moved.text}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs font-normal">
                        {t("overview.noComparison")}
                      </span>
                    )
                  ) : null}
                  {sincePeriod ? (
                    <span className="text-muted-foreground text-xs font-normal">
                      {sincePeriod}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          {quietWeeks && compared ? (
            <p className="text-muted-foreground -mt-3 text-xs">
              {t("overview.tooFewToCompare", {
                period: windowLabel(compared.current),
                // A raw number: the message picks the plural and formats it.
                current: weekImpressions.current ?? 0,
                previous: format.number(weekImpressions.previous ?? 0),
              })}
            </p>
          ) : quietRates.length ? (
            <p className="text-muted-foreground -mt-3 text-xs">
              {t("overview.tooFewToCompareRates", {
                which: quietRates.length > 1 ? "both" : quietRates[0],
              })}
            </p>
          ) : null}
          {/* The chart and its two disclosures read as one block. */}
          <div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium">
                  {t("overview.perDay", { metric: label(active) })}
                </p>
                {/* The tiles are the chart's switch; say so, since they read as plain numbers. */}
                {visible.length > 1 ? (
                  <p className="text-muted-foreground text-xs">
                    {t("overview.pickTile")}
                  </p>
                ) : null}
              </div>
              {seoCoverageIsNews(active) ? (
                <SeoState>{t(`coverageStatus.${active.coverage}`)}</SeoState>
              ) : null}
              {active.points.length ? (
                <SeoTrendChart
                  key={active.id}
                  label={label(active)}
                  points={active.points}
                  unit={active.unit}
                  unavailable={t("none")}
                  formatValue={(point) => measuredValue(point, active.unit)}
                  markers={seoChangeMarkers(
                    workspace.timeline,
                    active.timeZone,
                  )}
                />
              ) : (
                <p className="text-muted-foreground py-6 text-sm">
                  {t("overview.noDailyTrend")}
                </p>
              )}
            </div>
            <details className="text-muted-foreground text-xs">
              <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-3 focus-visible:ring-2 focus-visible:outline-none">
                {t("overview.measurementDetails")}
              </summary>
              <div className="space-y-2 pt-2">
                {compared ? (
                  <p>
                    {t("overview.windowDays", {
                      current: windowLabel(compared.current),
                      previous: windowLabel(compared.previous),
                    })}
                  </p>
                ) : null}
                {/* Explains why the chart ends days before the sync. */}
                {active.source === "search_console" ? (
                  <p>{t("overview.reportDelay")}</p>
                ) : null}
                {/* The queries card has no fold of its own; this one explains it, whichever source is shown. */}
                {workspace.searchQueries ? <p>{t("queries.help")}</p> : null}
                <p>
                  {t("statistics.property")}: <bdi>{active.propertyId}</bdi>
                </p>
                <p>{t("overview.timeZone", { timeZone: active.timeZone })}</p>
                {active.notes.map((note, index) => (
                  <p
                    key={`${index}:${note}`}
                    className="whitespace-pre-wrap break-words"
                  >
                    {note}
                  </p>
                ))}
              </div>
            </details>
          </div>
        </div>
      ) : (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4 sm:p-5")}>
          <h3 className="font-medium">{t("overview.trafficSetup")}</h3>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t(
              connected
                ? "overview.trafficSyncBody"
                : "overview.trafficSetupBody",
            )}
          </p>
          {canSync ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                model.openStatistics(connected ? "search_console" : undefined)
              }
            >
              {connected ? <RefreshCw /> : <Plug />}
              {t(connected ? "syncStatistics" : "overview.manageConnections")}
            </Button>
          ) : null}
        </div>
      )}
    </SeoSection>
  );
}
