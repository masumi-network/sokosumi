"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoAgentHome } from "./seo-agent-home";
import { SeoMeasurements } from "./seo-measurements";
import { SeoMonitors } from "./seo-monitors";
import { seoOverviewModel } from "./seo-overview-model";
import {
  SeoDate,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import { SeoTimeline } from "./seo-timeline";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoOverview({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  const overview = seoOverviewModel(data);
  // Timeline rows carry their own check's coverage; only checks without a row are listed here.
  const onTimeline = new Set(data.timeline.map((event) => event.observationId));
  const offTimeline = data.observations.filter(
    (observation) => !onTimeline.has(observation.id),
  );
  return (
    <div className="space-y-5">
      <SeoAgentHome model={model} />
      {overview.issues.length ? (
        <SeoSection title={t("overview.findings")}>
          {overview.issues.map((finding) => (
            <article
              key={finding.id}
              className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
            >
              <div className="flex flex-wrap items-start gap-2">
                <SeoState>{t(`severity.${finding.severity}`)}</SeoState>
                <h3 className="text-sm font-medium">{finding.title}</h3>
              </div>
              <SeoPageLink url={finding.pageUrl} />
              <details className="text-muted-foreground text-sm">
                <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 focus-visible:ring-2 focus-visible:outline-none">
                  {t("overview.checkDetails")}
                </summary>
                <ul className="list-inside list-disc space-y-1 pt-3">
                  {finding.evidence.map((evidence, index) => (
                    <li key={`${index}:${evidence}`} className="break-words">
                      {evidence}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3 pt-3 text-xs">
                  <SeoDate value={finding.observedAt} />
                  <SeoSource
                    observationId={finding.observationId}
                    workspace={data}
                  />
                </div>
              </details>
            </article>
          ))}
        </SeoSection>
      ) : null}
      {overview.hasFailedChecks && overview.emptyState !== "incomplete" ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.checksIncompleteBody")}
        </p>
      ) : null}
      <SeoMeasurements model={model} />
      {overview.recentChecks.length ? (
        <SeoSection title={t("overview.recentChecks")}>
          {overview.recentChecks.map((item) => (
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
      {data.monitors.length ||
      data.availableActions.canCreateMonitor === true ? (
        <SeoMonitors model={model} />
      ) : null}
      <SeoTimeline
        workspace={data}
        onRetry={
          data.availableActions.canRequestAnalysis
            ? () => model.setDialog("analysis")
            : undefined
        }
      />
      {overview.diagnostics.length || offTimeline.length ? (
        <details className={cn(HOLDER_CLASS, "text-sm")}>
          <summary className="focus-visible:ring-ring cursor-pointer rounded-sm px-2 py-2.5 focus-visible:ring-2 focus-visible:outline-none">
            <h2 className="inline text-sm font-semibold">
              {t("overview.diagnostics")}
            </h2>
          </summary>
          <div className={cn(HOLDER_ITEM_CLASS, "mt-2 space-y-4 p-4")}>
            {offTimeline.map((observation) => (
              <div
                key={observation.id}
                className="text-muted-foreground space-y-2"
              >
                <p>
                  {t("overview.coverageCounts", {
                    checked: observation.coverage.checked,
                    skipped: observation.coverage.skipped,
                    failed: observation.coverage.failed,
                  })}
                </p>
                {observation.coverage.modules ? (
                  <p>
                    {t("overview.moduleCoverage", {
                      notRequested: observation.coverage.modules.notRequested,
                      failed: observation.coverage.modules.failed,
                    })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3 text-xs">
                  <SeoDate value={observation.observedAt} />
                  <SeoSource observationId={observation.id} workspace={data} />
                </div>
              </div>
            ))}
            {overview.diagnostics.map((finding) => (
              <article key={finding.id} className="space-y-3">
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
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
