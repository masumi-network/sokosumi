"use client";

import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { seoWeekOverWeek } from "./seo-performance-model";
import { SeoDate, SeoPeriod, SeoSection, SeoState } from "./seo-shared";
import {
  latestSeoMeasurements,
  seoCoverageIsNews,
  seoDefaultMetric,
  seoReportedPeriod,
} from "./seo-statistics-model";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Measured traffic for the selected pages: totals, the newest 7 reported days against the 7 before, and the daily trend. */
export function SeoMeasurements({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
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
  // Google reports a few days late; the period names the days that have data, for every shown metric.
  const reported = seoReportedPeriod(visible);
  const canSync = workspace.availableActions.canSyncMetrics;
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
      ? format.number(value, { style: "percent", maximumFractionDigits: 1 })
      : format.number(value, {
          // Position always shows one decimal, so 1.0 and 3.8 read alike.
          minimumFractionDigits: unit === "position" ? 1 : 0,
          maximumFractionDigits: unit === "count" ? 0 : 1,
          signDisplay,
        });
  }
  /** Change from the previous 7 days. A lower position is better. */
  function change(
    week: { current: number | null; previous: number | null },
    unit: ProjectSeoMetric["unit"],
  ) {
    if (week.current === null || week.previous === null) return null;
    // Judge the change between the values as shown: equal shown values are no change.
    const scale = 10 ** (unit === "count" ? 0 : unit === "ratio" ? 3 : 1);
    const shown = (value: number) => Math.round(value * scale) / scale;
    const delta = shown(shown(week.current) - shown(week.previous));
    if (delta === 0) return { text: t("overview.noChange"), Icon: null };
    // The arrow points up for good news; a position improves as it falls.
    const Icon = (unit === "position" ? delta < 0 : delta > 0)
      ? ArrowUp
      : ArrowDown;
    // A rate changes by percentage points, not by a percent of itself.
    if (unit === "ratio")
      return {
        text: t("overview.percentPoints", {
          value: format.number(delta * 100, {
            maximumFractionDigits: 1,
            signDisplay: "exceptZero",
          }),
        }),
        Icon,
      };
    if (unit !== "position")
      return { text: measuredValue(delta, unit, "exceptZero"), Icon };
    const amount = measuredValue(Math.abs(delta), unit);
    return {
      text: t(delta < 0 ? "overview.better" : "overview.worse", { amount }),
      Icon,
    };
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
  function weekValue(value: number | null, unit: ProjectSeoMetric["unit"]) {
    return value === null ? t("none") : measuredValue(value, unit);
  }
  return (
    <SeoSection
      title={t("overview.measurements")}
      description={
        active ? (
          <>
            {t(`statistics.${active.source}`)} ·{" "}
            <SeoPeriod
              from={reported?.from ?? active.from}
              to={reported?.to ?? active.to}
            />{" "}
            ·{" "}
            {t(
              active.channel === "organic"
                ? "statistics.channelOrganic"
                : "statistics.channelAll",
            )}
          </>
        ) : undefined
      }
      actions={
        active && providers.length > 1 ? (
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
        ) : undefined
      }
    >
      {active ? (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-5 p-4 sm:p-5")}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {visible.map((metric) => {
              const week = compared?.values[metric.key] ?? null;
              const moved = week ? change(week, metric.unit) : null;
              return (
                <Button
                  key={metric.id}
                  variant="outline"
                  type="button"
                  aria-pressed={active.id === metric.id}
                  className={cn(
                    "h-auto min-w-0 flex-col items-start gap-1 px-3 py-3 text-start whitespace-normal",
                    active.id === metric.id && "bg-quinary border-foreground",
                  )}
                  onClick={() => setMetric(metric.id)}
                >
                  <span className="text-muted-foreground flex items-center gap-2 text-xs font-normal">
                    {active.id === metric.id ? (
                      <span
                        aria-hidden
                        className="bg-chart-1 h-0.5 w-3 shrink-0 rounded-full"
                      />
                    ) : null}
                    {label(metric)}
                  </span>
                  <span
                    className="text-2xl font-semibold"
                    data-testid={`seo-metric-${metric.key}`}
                  >
                    {value(metric)}
                  </span>
                  {week ? (
                    <span className="text-muted-foreground space-y-0.5 text-xs font-normal">
                      {(["current", "previous"] as const).map((side) => (
                        <span key={side} className="block">
                          {t(`overview.window.${side}`, {
                            value: weekValue(week[side], metric.unit),
                          })}
                        </span>
                      ))}
                      {moved ? (
                        <span className="text-foreground flex items-center gap-1 font-medium">
                          {moved.Icon ? (
                            <moved.Icon className="size-3" aria-hidden />
                          ) : null}
                          {moved.text}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {t("overview.perDay", { metric: label(active) })}
            </p>
            {active.points.length ? (
              <SeoTrendChart
                key={active.id}
                label={label(active)}
                points={active.points}
                unit={active.unit}
                unavailable={t("none")}
                formatValue={(point) => measuredValue(point, active.unit)}
              />
            ) : (
              <p className="text-muted-foreground py-6 text-sm">
                {t("overview.noDailyTrend")}
              </p>
            )}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="flex flex-wrap items-center gap-2">
              <span>
                {t("overview.synced")} <SeoDate value={active.observedAt} />
              </span>
              {seoCoverageIsNews(active) ? (
                <SeoState>{t(`coverageStatus.${active.coverage}`)}</SeoState>
              ) : null}
            </p>
            {canSync && active.source === "search_console" ? (
              <Button
                variant="outline"
                size="sm"
                loading={model.pending}
                onClick={() => {
                  void model.refreshSearchStatistics(active);
                }}
              >
                {t("syncNow")}
              </Button>
            ) : canSync ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  model.openStatistics(
                    active.source === "ga4" ||
                      active.source === "search_console"
                      ? active.source
                      : undefined,
                  )
                }
              >
                {t("syncStatistics")}
              </Button>
            ) : null}
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
      ) : (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4 sm:p-5")}>
          <h3 className="font-medium">{t("overview.trafficSetup")}</h3>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t("overview.trafficSetupBody")}
          </p>
          {canSync ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => model.openStatistics()}
            >
              {t("overview.manageConnections")}
            </Button>
          ) : null}
        </div>
      )}
    </SeoSection>
  );
}
