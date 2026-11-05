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
  const running = data.analyses.filter(
    (item) =>
      item.status === "requested" ||
      item.status === "running" ||
      item.status === "failed",
  );
  return (
    <div className="space-y-5">
      {!data.observations.length ? <SeoGettingStarted model={model} /> : null}
      <SeoMeasurements
        workspace={data}
        onSync={() => model.setDialog("statistics")}
      />
      {running.length ? (
        <SeoSection title={t("overview.recentChecks")}>
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
      {data.monitors.length || data.availableActions.canRequestAnalysis ? (
        <SeoMonitors model={model} />
      ) : null}
      {data.actions.length ? <SeoActions model={model} compact /> : null}
      {data.observations.length ||
      data.findings.length ||
      data.timeline.length ? (
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
          <SeoTimeline
            workspace={data}
            onRetry={
              data.availableActions.canRequestAnalysis
                ? () => model.setDialog("analysis")
                : undefined
            }
          />
        </div>
      ) : null}
    </div>
  );
}
