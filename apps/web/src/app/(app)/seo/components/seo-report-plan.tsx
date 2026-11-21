"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId } from "react";
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
import { seoPlanChange } from "./seo-report-plan-model";
import { SeoFoldSummary, SeoPageText } from "./seo-shared";
import type { useSelectedSeoPlan } from "./use-selected-seo-plan";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoReportPlan({
  model,
  onOpen,
  selected,
}: {
  selected: ReturnType<typeof useSelectedSeoPlan>;
  model: SeoWorkspaceModel;
  onOpen: (action: ProjectSeoAction, button: HTMLButtonElement) => void;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const ui = useTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const selector = useId();
  const { report, reports, plan, setPicked, historical } = selected;
  if (!report) return null;
  const reason = plan?.lead.reason ?? "";
  const sentences = Array.from(
    new Intl.Segmenter("en", { granularity: "sentence" }).segment(reason),
    (part) => part.segment.trim(),
  );
  const reasonDetails = sentences.length > 2 ? sentences.slice(1) : [];
  const summary = reasonDetails.length ? sentences[0] : reason;
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
  const actionButton = (id?: string, origin?: string) => {
    const action =
      !historical &&
      id &&
      model.data.actions.find(
        (row) => row.observationId === origin && row.id === id,
      );
    return action ? (
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => onOpen(action, e.currentTarget)}
      >
        {ui("reportPlan.open")}
      </Button>
    ) : null;
  };
  function actionReason(item: NonNullable<typeof plan>["lead"]) {
    return (
      <details className="max-w-prose space-y-2">
        <SeoFoldSummary className="min-h-9">
          {ui("reportPlan.whyItem")}
        </SeoFoldSummary>
        <p>{item.reason}</p>
        {item.nextCheck && <p>{item.nextCheck}</p>}
        {item.evidence.length > 0 && (
          <details>
            <SeoFoldSummary className="min-h-9">
              {ui("reportPlan.evidence")}
            </SeoFoldSummary>
            <ul className="text-muted-foreground list-disc space-y-2 ps-5">
              {item.evidence.map((line, i) => (
                <li key={i} dir="auto">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
    );
  }
  return (
    <section
      aria-label={ui("reportPlan.title")}
      className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-5 p-4 sm:p-6")}
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
        <div
          key={report.id}
          lang="en"
          className="min-w-0 space-y-5 break-words text-sm leading-relaxed"
        >
          {change && (
            <p className="font-medium">{t("reportPlan.changedShort")}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 space-y-1">
              <h4 className="max-w-prose text-base font-semibold">
                {plan.reconsider
                  ? t(`reportPlan.first.${plan.basis}`, {
                      event: plan.control?.event ?? "",
                    })
                  : plan.lead.title}
              </h4>
              <SeoPageText url={plan.lead.pageUrl} workspace={model.data} />
            </div>
            {!plan.reconsider &&
              actionButton(plan.lead.actionId, plan.originId)}
          </div>
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
            <div className="space-y-2">
              <p>
                {t("reportPlan.then", { step: plan.follow.title })}
                {plan.follow.pageUrl !== plan.lead.pageUrl && (
                  <SeoPageText
                    url={plan.follow.pageUrl}
                    workspace={model.data}
                  />
                )}
              </p>
              {actionReason(plan.follow)}
              {actionButton(plan.follow.actionId, plan.followOrigin)}
            </div>
          )}
          <details key={report.id} className="max-w-prose space-y-3">
            <SeoFoldSummary className="min-h-10 font-medium">
              {ui("reportPlan.why")}
            </SeoFoldSummary>
            <p>
              {plan.reconsider ? t(`reportPlan.basis.${plan.basis}`) : summary}
            </p>
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
            {plan.compareOrder && <p>{t("reportPlan.orderReason")}</p>}
            {(plan.lead.evidence.length > 0 || reasonDetails.length > 0) && (
              <details>
                <SeoFoldSummary className="min-h-9">
                  {ui("reportPlan.evidence")}
                </SeoFoldSummary>
                {!plan.reconsider &&
                  reasonDetails.map((line, i) => (
                    <p key={i} className="my-2">
                      {line}
                    </p>
                  ))}
                <ul className="text-muted-foreground list-disc space-y-2 ps-5">
                  {plan.lead.evidence.map((line, i) => (
                    <li key={i} dir="auto">
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {plan.control && <SeoGoalInvestigation control={plan.control} />}
            {plan.review && <p>{seoFollowUpText(plan.review, t)}</p>}
            {plan.lead.alternative && <p>{plan.lead.alternative}</p>}
            <div className="space-y-1">
              <h5 className="font-medium">{ui("reportPlan.verify")}</h5>
              <p>
                {!plan.reconsider && plan.lead.nextCheck
                  ? plan.lead.nextCheck
                  : t(`reportPlan.measure.${plan.objective ?? "general"}`)}
              </p>
            </div>
          </details>
          {plan.more.length > 0 && (
            <div className="divide-y border-t">
              {(["fixes", "content"] as const).map((section) => {
                const rows = plan.more.filter((row) => row.section === section);
                if (!rows.length) return null;
                return (
                  <details key={section} className="group min-w-0 py-2">
                    <SeoFoldSummary className="min-h-11 justify-between gap-4 py-1 font-medium">
                      <span>
                        <span>
                          {t(`reportPlan.groups.${section}`, {
                            count: rows.length,
                          })}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground block max-w-prose font-normal group-open:hidden"
                        >
                          {rows[0]?.item.title}
                        </span>
                      </span>
                    </SeoFoldSummary>
                    <ul className="divide-y">
                      {rows.map(({ item, originId }, i) => (
                        <li key={i} className="space-y-2 py-4">
                          <h5 className="max-w-prose font-medium">
                            {item.title}
                          </h5>
                          <SeoPageText
                            url={item.pageUrl}
                            workspace={model.data}
                          />
                          {item.queries?.length ? (
                            <p className="text-muted-foreground">
                              {t("reportPlan.queries", {
                                queries: item.queries.join(", "),
                              })}
                            </p>
                          ) : null}
                          {actionReason(item)}
                          {actionButton(item.actionId, originId)}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
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
