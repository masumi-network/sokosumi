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

/** Every fold of the plan is one row: its words at the start, its arrow at the end of the card. */
const FOLD_ROW_CLASS = "min-h-12 justify-between gap-4";
/** What a fold shows: lines of reading width, with room before the next row. */
const FOLD_BODY_CLASS = "max-w-prose space-y-3 pt-1 pb-4";

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
  const { report, options, plan, setPicked, historical } = selected;
  if (!report) return null;
  const reason = plan?.lead.reason ?? "";
  const sentences = Array.from(
    new Intl.Segmenter("en", { granularity: "sentence" }).segment(reason),
    (part) => part.segment.trim(),
  );
  const reasonDetails = sentences.length > 2 ? sentences.slice(1) : [];
  const summary = reasonDetails.length ? sentences[0] : reason;
  const change = seoPlanChange(model.data, report, model.brief?.data, plan);
  const evidenceList = (lines: string[]) =>
    lines.length > 0 && (
      <ul className="text-muted-foreground list-disc space-y-2 ps-5">
        {lines.map((line, i) => (
          <li key={i} dir="auto">
            {line}
          </li>
        ))}
      </ul>
    );
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
  // One more step of the plan: a row with its title and page. It opens in place, as the rows of the worklist do.
  function planStep(
    item: NonNullable<typeof plan>["lead"],
    originId: string | undefined,
    title: string = item.title,
  ) {
    return (
      <details className="min-w-0">
        <SeoFoldSummary className={cn(FOLD_ROW_CLASS, "py-2")}>
          <span className="min-w-0 space-y-0.5">
            <h5 className="font-medium">{title}</h5>
            <SeoPageText url={item.pageUrl} workspace={model.data} />
          </span>
        </SeoFoldSummary>
        <div className={FOLD_BODY_CLASS}>
          {item.queries?.length ? (
            <p className="text-muted-foreground">
              {t("reportPlan.queries", {
                queries: item.queries.join(", "),
              })}
            </p>
          ) : null}
          <p>{item.reason}</p>
          {item.nextCheck && <p>{item.nextCheck}</p>}
          {evidenceList(item.evidence)}
          {actionButton(item.actionId, originId)}
        </div>
      </details>
    );
  }
  return (
    <section
      aria-label={ui("reportPlan.title")}
      className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
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
          className="min-w-0 space-y-4 break-words text-sm leading-relaxed"
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
          <div className="divide-y border-t">
            <details key={report.id}>
              <SeoFoldSummary className={cn(FOLD_ROW_CLASS, "font-medium")}>
                {ui("reportPlan.why")}
              </SeoFoldSummary>
              <div className={FOLD_BODY_CLASS}>
                <p>
                  {plan.reconsider
                    ? t(`reportPlan.basis.${plan.basis}`)
                    : summary}
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
                        {
                          options.find((o) => o.value === source.reportId)
                            ?.label
                        }
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
                      ? t("reportPlan.missingComparison", {
                          event: plan.eventName,
                        })
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
                      from: new Date(plan.exposure.from)
                        .toISOString()
                        .slice(0, 10),
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
                {!plan.reconsider &&
                  reasonDetails.map((line, i) => <p key={i}>{line}</p>)}
                {plan.lead.evidence.length > 0 && (
                  <div className="space-y-1">
                    <h5 className="font-medium">{ui("reportPlan.evidence")}</h5>
                    {evidenceList(plan.lead.evidence)}
                  </div>
                )}
                {plan.control && (
                  <SeoGoalInvestigation control={plan.control} />
                )}
                {plan.review && <p>{seoFollowUpText(plan.review, t)}</p>}
                {plan.lead.alternative && (
                  <div className="space-y-1">
                    <h5 className="font-medium">
                      {ui("reportPlan.alternative")}
                    </h5>
                    <p>{plan.lead.alternative}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <h5 className="font-medium">{ui("reportPlan.verify")}</h5>
                  <p>
                    {!plan.reconsider && plan.lead.nextCheck
                      ? plan.lead.nextCheck
                      : t(`reportPlan.measure.${plan.objective ?? "general"}`)}
                  </p>
                </div>
              </div>
            </details>
            {plan.follow &&
              planStep(
                plan.follow,
                plan.followOrigin,
                t("reportPlan.then", { step: plan.follow.title }),
              )}
            {(["fixes", "content"] as const).map((section) => {
              const rows = plan.more.filter((row) => row.section === section);
              if (!rows.length) return null;
              return (
                <details key={section} className="min-w-0">
                  <SeoFoldSummary className={cn(FOLD_ROW_CLASS, "font-medium")}>
                    {t(`reportPlan.groups.${section}`, { count: rows.length })}
                  </SeoFoldSummary>
                  {/* The steps of a group stand in from its title, so the group reads as their parent. */}
                  <ul className="ms-4 divide-y border-t">
                    {rows.map(({ item, originId }, i) => (
                      <li key={i}>{planStep(item, originId)}</li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
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
