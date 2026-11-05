"use client";

import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { DailyBarChart } from "@/components/performance/daily-bar-chart";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActions } from "./seo-actions";
import { SeoMonitors } from "./seo-monitors";
import {
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import { SeoTimeline } from "./seo-timeline";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

function SeoMetricCard({ metric }: { metric: ProjectSeoMetric }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const label = t.has(`metrics.${metric.key}`)
    ? t(`metrics.${metric.key}`)
    : metric.label;
  const value =
    metric.coverage === "unavailable" || metric.value === null
      ? t("none")
      : metric.unit === "ratio"
        ? format.number(metric.value, {
            style: "percent",
            maximumFractionDigits: 1,
          })
        : format.number(metric.value, {
            maximumFractionDigits: metric.unit === "count" ? 0 : 1,
          });
  return (
    <article className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <SeoState>{t(`coverageStatus.${metric.coverage}`)}</SeoState>
      </div>
      <p
        className="text-2xl font-semibold tabular-nums"
        data-testid={`seo-metric-${metric.key}`}
      >
        {value}
      </p>
      {metric.points.length ? (
        <DailyBarChart
          label={label}
          points={metric.points}
          unavailable={t("none")}
        />
      ) : null}
      <div className="text-muted-foreground space-y-1 text-xs">
        <p>
          {t("source")}:{" "}
          {metric.source === "ga4" || metric.source === "search_console"
            ? t(`statistics.${metric.source}`)
            : metric.source}{" "}
          ·{" "}
          {t(
            metric.channel === "organic"
              ? "statistics.channelOrganic"
              : "statistics.channelAll",
          )}
        </p>
        <p>
          {t("period")}:{" "}
          {format.dateTime(new Date(`${metric.from}T12:00:00Z`), {
            dateStyle: "medium",
            timeZone: "UTC",
          })}{" "}
          /{" "}
          {format.dateTime(new Date(`${metric.to}T12:00:00Z`), {
            dateStyle: "medium",
            timeZone: "UTC",
          })}{" "}
          ({metric.timeZone})
        </p>
        <p>
          {t("observed")}: <SeoDate value={metric.observedAt} />
        </p>
        {metric.notes.map((note, index) => (
          <p
            key={`${index}:${note}`}
            className="whitespace-pre-wrap break-words"
          >
            {note}
          </p>
        ))}
      </div>
    </article>
  );
}

export function SeoMeasurements({
  workspace,
  onSync,
}: {
  workspace: ProjectSeoWorkspace;
  onSync: () => void;
}) {
  const t = useTranslations("App.Seo");
  return (
    <SeoSection
      title={t("overview.measurements")}
      actions={
        workspace.availableActions.canSyncMetrics ? (
          <Button size="sm" variant="outline" onClick={onSync}>
            {t("syncStatistics")}
          </Button>
        ) : undefined
      }
    >
      <div className="px-2 pb-2">
        <p className="text-muted-foreground text-sm">
          {t("overview.measurementsBody")}
        </p>
      </div>
      {workspace.metricsStatus !== "available" ? (
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")} role="status">
          <p className="text-muted-foreground text-sm">
            {t(`overview.${workspace.metricsStatus}`)}
          </p>
          {workspace.metricsStatus === "not_connected" ||
          workspace.metricsStatus === "unavailable" ? (
            <Button variant="outline" size="sm" onClick={onSync}>
              {t("overview.manageConnections")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {workspace.metrics.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workspace.metrics.map((metric) => (
            <SeoMetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      ) : null}
    </SeoSection>
  );
}

export function SeoOverview({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  const running = data.analyses.filter(
    (item) => item.status === "requested" || item.status === "running",
  );
  return (
    <div className="space-y-5">
      <SeoMeasurements
        workspace={data}
        onSync={() => model.setDialog("statistics")}
      />
      {running.length ? (
        <SeoSection title={t("analysis.running")}>
          {running.map((item) => (
            <div
              key={item.id}
              className={cn(
                HOLDER_ITEM_CLASS,
                "flex flex-wrap items-center justify-between gap-3 p-4",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {t(`analysis.${item.kind}`)}
                </span>
                <SeoState>{t(`analysis.${item.status}`)}</SeoState>
              </div>
              {item.taskId ? (
                <Link
                  href={`/tasks/${encodeURIComponent(item.taskId)}`}
                  className="text-sm underline underline-offset-4"
                >
                  {t("openTask")}
                </Link>
              ) : null}
            </div>
          ))}
        </SeoSection>
      ) : null}
      <SeoMonitors model={model} />
      <SeoActions model={model} compact />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <SeoSection title={t("overview.findings")}>
          {data.findings.length ? (
            data.findings.map((finding) => (
              <article
                key={finding.id}
                className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <SeoState>{t(`severity.${finding.severity}`)}</SeoState>
                  <h3 className="text-sm font-medium">{finding.title}</h3>
                </div>
                <SeoPageLink url={finding.pageUrl} />
                <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
                  {finding.evidence.map((evidence, index) => (
                    <li key={`${index}:${evidence}`} className="break-words">
                      {evidence}
                    </li>
                  ))}
                </ul>
                <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
                  <SeoDate value={finding.observedAt} />
                  <SeoSource
                    observationId={finding.observationId}
                    workspace={data}
                  />
                </div>
              </article>
            ))
          ) : (
            <SeoEmpty
              title={t("overview.noFindings")}
              body={t("overview.noFindingsBody")}
            >
              <Button
                variant="outline"
                onClick={() => model.setDialog("import")}
              >
                {t("importAudit")}
              </Button>
            </SeoEmpty>
          )}
        </SeoSection>
        <SeoTimeline workspace={data} />
      </div>
    </div>
  );
}
