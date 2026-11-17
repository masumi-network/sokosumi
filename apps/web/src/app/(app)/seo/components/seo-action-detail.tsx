"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SeoCopyButton, useSeoActionInstructions } from "./seo-action-copy";
import { SeoActionTaskButton, useSeoActionFinding } from "./seo-action-finding";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import {
  SEO_SEVERITY_MARK_CLASS,
  SeoPageLink,
  SeoSource,
  SeoState,
  seoPageLabel,
  seoSiteUrl,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The tint of the impact chip and the found line follows the impact: the orange of an issue, the grey of a minor
 * one or a suggestion, as the dot of the impact label.
 */
const TINT: Record<SeoIssueSeverity | "none", { fill: string; edge: string }> =
  {
    critical: { fill: "bg-chart-2-quinary", edge: "border-chart-2" },
    major: { fill: "bg-chart-2-quinary", edge: "border-chart-2" },
    minor: { fill: "bg-chart-5-quinary", edge: "border-chart-5" },
    none: { fill: "bg-chart-5-quinary", edge: "border-chart-5" },
  };

/**
 * An action in the dialog of the Agent tab: a head with the title and its facts, the body in titled parts, and
 * the buttons in a bar at the foot. The details show at once; a dialog has the room a row does not.
 */
export function SeoActionDetail({
  action,
  model,
  severity,
}: {
  action: ProjectSeoAction;
  model: SeoWorkspaceModel;
  severity: SeoIssueSeverity | null;
}) {
  const t = useTranslations("App.Seo");
  const finding = useSeoActionFinding(action, model);
  const instructions = useSeoActionInstructions(action, finding);
  const problem = seoOverviewModel(model.data).actionProblem(action);
  return (
    <>
      {/* The top padding keeps the close button clear of the title. */}
      <div className="space-y-3 border-b px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-center gap-2 pe-8 text-xs">
          {severity ? (
            <span
              title={t(`severityHint.${severity}`)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium whitespace-nowrap",
                TINT[severity].fill,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  SEO_SEVERITY_MARK_CLASS[severity],
                )}
              />
              {t(`severity.${severity}`)}
            </span>
          ) : (
            <SeoState>{t(`actions.kind.${action.kind}`)}</SeoState>
          )}
          {action.status !== "recommended" ? (
            <SeoState>{t(`actions.${action.status}`)}</SeoState>
          ) : null}
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 whitespace-nowrap">
            {t("actions.effort")}: {t(`priority.${action.effort}`)}
          </span>
        </div>
        <DialogTitle className="text-lg leading-snug font-semibold break-words">
          {action.title}
        </DialogTitle>
        <SeoPageLink
          url={action.pageUrl}
          site={seoSiteUrl(model.data)}
          label={seoPageLabel(model.data, action.pageUrl)}
        />
      </div>
      {/* The body gives up its room first, down to a floor: on a very short screen the whole dialog scrolls, so
          the buttons at the foot stay in reach. */}
      <div className="min-h-32 space-y-5 overflow-y-auto px-6 py-5 text-sm">
        <p
          className={cn(
            "rounded-md border-s-4 px-4 py-3 whitespace-pre-wrap break-words",
            TINT[severity ?? "none"].fill,
            TINT[severity ?? "none"].edge,
          )}
        >
          {finding}
          {problem?.footnote ? ` ${problem.footnote}` : null}
        </p>
        <DetailPart title={t("actions.why")}>
          {severity ? (
            <p className="text-muted-foreground">
              {t(`severityHint.${severity}`)}
            </p>
          ) : action.kind === "opportunity" ? (
            // A suggestion says what it is not: no error, and no promise of traffic.
            <p className="text-muted-foreground">
              {t("actions.opportunitiesHelp")}
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words">{action.why}</p>
        </DetailPart>
        {problem ? (
          <DetailPart title={t("actions.effect")}>
            <p className="whitespace-pre-wrap break-words">
              {action.expectedEffect}
            </p>
          </DetailPart>
        ) : null}
        {action.evidence.length ? (
          <DetailPart title={t("actions.evidence")}>
            <ul className="divide-y rounded-md border">
              {action.evidence.map((line, index) => (
                <li
                  key={`${index}:${line}`}
                  className="text-muted-foreground px-3 py-2 text-xs break-words"
                >
                  {line}
                </li>
              ))}
            </ul>
          </DetailPart>
        ) : null}
        {action.edit ? (
          <DetailPart title={t("actions.change")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {t("actions.before")}
                </p>
                <pre className="bg-muted text-muted-foreground overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                  {action.edit.before ?? t("actions.noBefore")}
                </pre>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{t("actions.after")}</p>
                  <SeoCopyButton
                    text={action.edit.after}
                    label={t("actions.copyFix")}
                    className="-my-1 h-7"
                  />
                </div>
                <pre className="bg-chart-3-quinary border-chart-3 overflow-x-auto rounded-md border p-3 text-xs whitespace-pre-wrap break-words">
                  {action.edit.after}
                </pre>
              </div>
            </div>
          </DetailPart>
        ) : null}
        <SeoSource
          observationId={action.observationId}
          workspace={model.data}
        />
      </div>
      <div className="bg-senary flex flex-wrap justify-end gap-2 border-t px-6 py-4">
        <SeoCopyButton
          text={instructions}
          label={t("actions.copyInstructions")}
        />
        <SeoActionTaskButton action={action} model={model} />
      </div>
    </>
  );
}

function DetailPart({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
