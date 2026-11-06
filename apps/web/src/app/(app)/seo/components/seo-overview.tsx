"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActions } from "./seo-actions";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoMeasurements } from "./seo-measurements";
import { SeoMonitors } from "./seo-monitors";
import { seoOverviewModel } from "./seo-overview-model";
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

export function SeoOverview({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  const overview = seoOverviewModel(data);
  return (
    <div className="space-y-5">
      {!data.observations.length ? <SeoGettingStarted model={model} /> : null}
      {overview.recommendedActions.length ? (
        <SeoActions model={model} compact />
      ) : null}
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
                <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 focus-visible:ring-2 focus-visible:outline-none">
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
      ) : !overview.recommendedActions.length &&
        (data.observations.length || overview.emptyState === "incomplete") ? (
        <SeoEmpty
          title={t(
            overview.emptyState === "no_fixes"
              ? "overview.noFixes"
              : overview.emptyState === "incomplete"
                ? "actions.checksIncomplete"
                : "overview.noFindings",
          )}
          body={t(
            overview.emptyState === "no_fixes"
              ? "overview.noFixesBody"
              : overview.emptyState === "incomplete"
                ? "actions.checksIncompleteBody"
                : "overview.noFindingsBody",
          )}
        >
          {data.availableActions.canSyncMetrics ? (
            <Button
              variant="outline"
              onClick={() => model.setDialog("statistics")}
            >
              {t("overview.manageConnections")}
            </Button>
          ) : null}
        </SeoEmpty>
      ) : null}
      {overview.hasFailedChecks && overview.emptyState !== "incomplete" ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.checksIncompleteBody")}
        </p>
      ) : null}
      <SeoMeasurements workspace={data} onSync={model.openStatistics} />
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
      {overview.diagnostics.length || data.observations.length ? (
        <SeoSection title={t("overview.diagnostics")}>
          <details className={cn(HOLDER_ITEM_CLASS, "p-4 text-sm")}>
            <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 font-medium focus-visible:ring-2 focus-visible:outline-none">
              {t("overview.checkDetails")}
            </summary>
            <div className="space-y-4 pt-4">
              {data.observations.map((observation) => (
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
                    <SeoSource
                      observationId={observation.id}
                      workspace={data}
                    />
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
        </SeoSection>
      ) : null}
      <SeoTimeline
        workspace={data}
        onRetry={
          data.availableActions.canRequestAnalysis
            ? () => model.setDialog("analysis")
            : undefined
        }
      />
    </div>
  );
}
