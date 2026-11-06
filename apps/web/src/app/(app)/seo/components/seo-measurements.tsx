"use client";

import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { DailyBarChart } from "@/components/performance/daily-bar-chart";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SeoDate, SeoSection, SeoState } from "./seo-shared";
import {
  latestSeoMeasurements,
  type SeoStatisticsProvider,
} from "./seo-statistics-model";

export function SeoMeasurements({
  workspace,
  onSync,
}: {
  workspace: ProjectSeoWorkspace;
  onSync: (source?: SeoStatisticsProvider) => void;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const metrics = latestSeoMeasurements(workspace.metrics);
  const providers = [...new Set(metrics.map((metric) => metric.source))];
  const [chosenProvider, setProvider] = useState("");
  const [chosenMetric, setMetric] = useState("");
  const provider = providers.includes(chosenProvider)
    ? chosenProvider
    : providers[0];
  const selectedSource =
    provider === "ga4" || provider === "search_console" ? provider : undefined;
  const visible = metrics.filter((metric) => metric.source === provider);
  const active =
    visible.find((metric) => metric.id === chosenMetric) ?? visible[0];
  function label(metric: ProjectSeoMetric) {
    return t.has(`metrics.${metric.key}`)
      ? t(`metrics.${metric.key}`)
      : metric.label;
  }
  function measuredValue(value: number, unit: ProjectSeoMetric["unit"]) {
    return unit === "ratio"
      ? format.number(value, {
          style: "percent",
          maximumFractionDigits: 1,
        })
      : format.number(value, {
          maximumFractionDigits: unit === "count" ? 0 : 1,
        });
  }
  function value(metric: ProjectSeoMetric) {
    return metric.value === null || metric.coverage === "unavailable"
      ? t("none")
      : measuredValue(metric.value, metric.unit);
  }
  function date(value: string) {
    return format.dateTime(new Date(`${value}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  }
  return (
    <SeoSection
      title={t("overview.measurements")}
      actions={
        workspace.availableActions.canSyncMetrics ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSync(selectedSource)}
          >
            {t("syncStatistics")}
          </Button>
        ) : undefined
      }
    >
      {active ? (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-5 p-4 sm:p-5")}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-muted-foreground text-sm">
                {t("overview.measurementsBody")}
              </p>
              <p className="text-muted-foreground text-xs">
                {date(active.from)} / {date(active.to)} ·{" "}
                {t(
                  active.channel === "organic"
                    ? "statistics.channelOrganic"
                    : "statistics.channelAll",
                )}
              </p>
            </div>
            {providers.length > 1 ? (
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
            ) : (
              <span className="text-sm font-medium">
                {t(`statistics.${active.source}`)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {visible.map((metric) => (
              <Button
                key={metric.id}
                variant="outline"
                type="button"
                aria-pressed={active.id === metric.id}
                className={cn(
                  "h-auto min-w-0 flex-col items-start gap-2 px-3 py-3 text-start whitespace-normal",
                  active.id === metric.id && "bg-quinary border-foreground",
                )}
                onClick={() => setMetric(metric.id)}
              >
                <span className="text-muted-foreground text-xs font-normal">
                  {label(metric)}
                </span>
                <span
                  className="text-2xl font-semibold tabular-nums"
                  data-testid={`seo-metric-${metric.key}`}
                >
                  {value(metric)}
                </span>
              </Button>
            ))}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("overview.dailyTrend")}</p>
            {active.points.length ? (
              <DailyBarChart
                label={label(active)}
                points={active.points}
                unavailable={t("none")}
                formatValue={(point) => measuredValue(point, active.unit)}
              />
            ) : (
              <p className="text-muted-foreground py-6 text-sm">
                {t("overview.noDailyTrend")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-muted-foreground">
              {t("observed")}: <SeoDate value={active.observedAt} />
            </p>
            <SeoState>{t(`coverageStatus.${active.coverage}`)}</SeoState>
          </div>
          <details className="text-muted-foreground text-xs">
            <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 focus-visible:ring-2 focus-visible:outline-none">
              {t("overview.measurementDetails")}
            </summary>
            <div className="space-y-2 pt-2">
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
          {workspace.availableActions.canSyncMetrics ? (
            <Button variant="outline" size="sm" onClick={() => onSync()}>
              {t("overview.manageConnections")}
            </Button>
          ) : null}
        </div>
      )}
      {workspace.availableActions.canSyncMetrics ? (
        <div
          className={cn(
            HOLDER_ITEM_CLASS,
            "flex flex-wrap items-center justify-between gap-4 px-4 py-3",
          )}
        >
          <p className="text-muted-foreground text-sm">
            {t("overview.googleConnections")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SeoConnectionButton provider="ga4" />
            <SeoConnectionButton provider="search_console" />
          </div>
        </div>
      ) : null}
    </SeoSection>
  );
}
