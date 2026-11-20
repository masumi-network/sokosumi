"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { seoFollowUpText } from "./seo-followup-review";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SeoGoalInvestigation } from "./seo-goal-investigation";
import {
  seoPlanChange,
  seoPlanReports,
  seoReportPlan,
} from "./seo-report-plan-model";
import { useSeasonalClock } from "./seo-seasonal-ideas-model";
import { SeoFoldSummary, SeoPageText } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoReportPlan({
  model,
  onOpen,
}: {
  model: SeoWorkspaceModel;
  onOpen: (action: ProjectSeoAction, button: HTMLButtonElement) => void;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const ui = useTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const [picked, setPicked] = useState<string | null>(null);
  const selector = useId();
  const reports = seoPlanReports(model.data);
  const now = useSeasonalClock(
    reports.some((report) => report.planCandidates?.some((row) => row.season)),
  );
  const report = reports.find((row) => row.id === picked) ?? reports[0];
  if (!report) return null;
  const historical =
    report.id !== reports[0]?.id ||
    Boolean(
      model.filters.to && model.filters.to < now.toISOString().slice(0, 10),
    );
  const plan = seoReportPlan(
    model.data,
    report,
    model.brief?.data,
    historical,
    now,
  );
  const change = seoPlanChange(model.data, report, model.brief?.data, plan);
  const options = reports.map((row) => {
    const kind = t.has(`analysis.${row.kind}`)
      ? t(`analysis.${row.kind}`)
      : t("timeline.checkRun");
    const date = format.dateTime(new Date(row.observedAt), "dateTimeWithYear", {
      timeZone: "UTC",
      timeZoneName: "short",
    });
    return {
      value: row.id,
      label: t("reportFiles.version", { checkType: kind, date }),
    };
  });
  const labels = new Set<string>();
  const duplicates = new Set<string>();
  for (const { label } of options) {
    if (labels.has(label)) duplicates.add(label);
    labels.add(label);
  }
  for (const option of options) {
    if (duplicates.has(option.label)) option.label += " · " + option.value;
  }
  const action =
    !historical &&
    plan &&
    !plan.reconsider &&
    model.data.actions.find(
      (row) =>
        row.observationId === plan.originId && row.id === plan.lead.actionId,
    );
  const outcome = plan?.objective ?? "general";
  return (
    <section
      aria-label={ui("reportPlan.title")}
      className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{ui("reportPlan.title")}</h3>
        {options.length > 1 ? (
          <SeoField id={selector} label={ui("reportFiles.run")}>
            <SeoSelect
              lang="en"
              id={selector}
              options={options}
              value={report.id}
              onValueChange={setPicked}
            />
          </SeoField>
        ) : (
          <span lang="en" className="text-muted-foreground text-xs">
            {options[0]?.label}
          </span>
        )}
      </div>
      {plan ? (
        <div lang="en" className="space-y-2 text-sm">
          {change && (
            <p className="font-medium">
              {t("reportPlan.changed", {
                reason:
                  plan.timing?.due && plan.timing.repeated && plan.timing.gap
                    ? t("reportPlan.windowReason", { month: plan.timing.month })
                    : plan.sources.length
                      ? plan.sources[0]!.evidence
                      : plan.reconsider
                        ? t(`reportPlan.basis.${plan.basis}`)
                        : plan.lead.reason,
              })}
            </p>
          )}
          {plan.objective && (
            <p className="text-muted-foreground">
              {t("reportPlan.goal", {
                goal:
                  model.brief?.data?.outcome ||
                  t(`brief.objectives.${plan.objective}`),
              })}
            </p>
          )}
          <h4 className="font-semibold">
            {plan.reconsider
              ? t(`reportPlan.first.${plan.basis}`, {
                  event: plan.control?.event ?? "",
                })
              : plan.lead.title}
          </h4>
          <SeoPageText url={plan.lead.pageUrl} workspace={model.data} />
          {plan.timing && (
            <p>
              {t(
                plan.timing.due ? "reportPlan.publish" : "reportPlan.prepare",
                {
                  prepare: plan.timing.prepare,
                  month: plan.timing.month,
                  query: plan.lead.queries?.[0] ?? "",
                },
              )}
            </p>
          )}
          {plan.corroboration && (
            <p>
              {t(`reportPlan.hypothesis.${plan.corroboration}`, {
                query: plan.lead.queries?.[0] ?? "",
              })}
            </p>
          )}
          {plan.follow && (
            <p>
              {t("reportPlan.then", { step: plan.follow.title })}
              {plan.follow.pageUrl !== plan.lead.pageUrl && (
                <SeoPageText url={plan.follow.pageUrl} workspace={model.data} />
              )}
            </p>
          )}
          <details key={report.id} className="space-y-2">
            <SeoFoldSummary className="min-h-10 font-medium">
              {ui("reportPlan.why")}
            </SeoFoldSummary>
            <p>{t(`reportPlan.basis.${plan.basis}`)}</p>
            {plan.timing && (
              <p>
                {t("reportPlan.peaks", {
                  periods: plan.timing.peaks.join(", "),
                })}
              </p>
            )}
            {plan.timing && !!plan.lead.queries?.length && (
              <p>
                {t("reportPlan.queries", {
                  queries: plan.lead.queries.join(", "),
                })}
              </p>
            )}
            {plan.sources.map((source, i) => (
              <p key={i}>
                {source.evidence}{" "}
                {source.reportId === report.id ? (
                  options.find((o) => o.value === report.id)?.label
                ) : (
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => setPicked(source.reportId)}
                  >
                    {options.find((o) => o.value === source.reportId)?.label}
                  </Button>
                )}
              </p>
            ))}
            {change && (
              <p>
                {t("reportPlan.was", { step: change.previous })}{" "}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setPicked(change.reportId)}
                >
                  {options.find((o) => o.value === change.reportId)?.label}
                </Button>
              </p>
            )}
            {plan.missingOutcome && (
              <p>
                {plan.eventName
                  ? t("reportPlan.missingComparison", { event: plan.eventName })
                  : t("reportPlan.missingOutcome", {
                      event: plan.detectedName ?? "",
                      action: t(
                        `brief.actions.${plan.missingOutcome.replaceAll(" ", "_")}`,
                      ),
                    })}{" "}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => model.setDialog("brief")}
                >
                  {ui("brief.title")}
                </Button>
              </p>
            )}
            {plan.exposure && (
              <p>
                {t("reportPlan.exposure", {
                  impressions: format.number(plan.exposure.impressions),
                  from: new Date(plan.exposure.from).toISOString().slice(0, 10),
                  to: new Date(plan.exposure.to).toISOString().slice(0, 10),
                })}
              </p>
            )}
            {plan.destination && plan.goal?.action && (
              <p>
                {t("reportPlan.destination", {
                  action: t(
                    `brief.actions.${plan.goal.action.replaceAll(" ", "_")}`,
                  ),
                  url: plan.destination,
                })}
              </p>
            )}
            {!plan.reconsider && <p>{plan.lead.reason}</p>}
            {plan.compareOrder && <p>{t("reportPlan.orderReason")}</p>}
            {plan.lead.evidence.length > 0 && (
              <ul className="text-muted-foreground list-disc space-y-1 ps-5">
                {plan.lead.evidence.map((line, i) => (
                  <li key={i} dir="auto">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {plan.control && <SeoGoalInvestigation control={plan.control} />}
            {plan.review && <p>{seoFollowUpText(plan.review, t)}</p>}
            {(plan.runnerUp || plan.lead.alternative) && (
              <div>
                <h5 className="font-medium">{t("reportPlan.alternative")}</h5>
                {plan.runnerUp && <p>{plan.runnerUp.item.title}</p>}
                {plan.runnerUp &&
                  !plan.exposure &&
                  !plan.strength &&
                  plan.runnerUp.basis === plan.basis && (
                    <p>{t("reportPlan.tie")}</p>
                  )}
                {plan.lead.alternative && <p>{plan.lead.alternative}</p>}
              </div>
            )}
            <h5 className="font-medium">{t("reportPlan.reassess")}</h5>
            {!plan.reconsider && plan.lead.nextCheck && (
              <p>{plan.lead.nextCheck}</p>
            )}
            <p>{t(`reportPlan.measure.${outcome}`)}</p>
          </details>
          {action && (
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => onOpen(action, event.currentTarget)}
            >
              {ui("reportPlan.open")}
            </Button>
          )}
        </div>
      ) : (
        <p lang="en" className="text-muted-foreground text-sm">
          {t(
            report.kind === "links"
              ? "reportPlan.linksEmpty"
              : "reportPlan.empty",
          )}
        </p>
      )}
    </section>
  );
}
