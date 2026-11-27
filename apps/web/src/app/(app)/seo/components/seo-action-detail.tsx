"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoCopyButton, useSeoActionInstructions } from "./seo-action-copy";
import { SeoActionTaskButton, useSeoActionFinding } from "./seo-action-finding";
import { SeoActionImpact } from "./seo-action-impact";
import { SeoBriefFollowUp, SeoBriefPagePriority } from "./seo-brief-summary";
import { seoFollowUpText } from "./seo-followup-review";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import {
  SEO_SEVERITY_MARK_CLASS,
  SeoFoldSummary,
  SeoMetaLine,
  SeoPageLink,
  SeoSource,
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
  const report = useSeoResultTranslations("App.Seo");
  const finding = useSeoActionFinding(action, model);
  const instructions = useSeoActionInstructions(action, finding);
  const rankedKeywordsRef = "rankingData.page.ranked";
  const references = action.decision
    ? action.evidence.filter(
        (line) => line === rankedKeywordsRef || /^[a-f0-9]{64}$/u.test(line),
      )
    : [];
  const observations = action.evidence.filter(
    (line) => !references.includes(line),
  );
  if (references.includes(rankedKeywordsRef))
    observations.push(report("actions.rankingEvidence"));
  const overview = seoOverviewModel(model.data);
  const problem = overview.actionProblem(action);
  const page = model.data.pages.find((item) => item.url === action.pageUrl);
  const followUp = model.brief?.data?.followUps?.find(
    (item) => item.pageId === page?.id,
  );
  const hasSource = model.data.observations.some(
    (item) => item.id === action.observationId && item.sourceTaskId,
  );
  const tint = TINT[severity ?? "none"];
  const effort = `${report("actions.effort")}: ${report(`priority.${action.effort}`)}`;
  return (
    <>
      {/* The top padding keeps the close button clear of the title. */}
      <div className="space-y-2 border-b px-6 pt-6 pb-4">
        <div lang="en" className="flex flex-wrap items-center gap-1.5 pe-8">
          {severity ? (
            <Chip
              title={report(`severityHint.${severity}`)}
              className={tint.fill}
              mark={SEO_SEVERITY_MARK_CLASS[severity]}
            >
              {report(`severity.${severity}`)}
            </Chip>
          ) : (
            <Chip className="text-muted-foreground border">
              {report(`actions.kind.${action.kind}`)}
            </Chip>
          )}
          {action.status !== "recommended" &&
          action.status !== "needs_review" ? (
            <Chip className="text-muted-foreground border">
              {report(`actions.${action.status}`)}
            </Chip>
          ) : null}
          {action.effort !== "unknown" && (
            <Chip className="bg-muted text-muted-foreground" title={effort}>
              {effort}
            </Chip>
          )}
        </div>
        <DialogTitle
          lang="en"
          className="text-lg leading-snug font-semibold break-words"
        >
          {action.title}
        </DialogTitle>
        {/* Where the action applies and where it comes from: one quiet line under the title. */}
        <SeoMetaLine
          className="text-xs"
          items={[
            [
              "page",
              <SeoPageLink
                key="page"
                quiet
                url={action.pageUrl}
                site={seoSiteUrl(model.data)}
                label={seoPageLabel(model.data, action.pageUrl)}
              />,
            ],
            [
              "source",
              // Without a result to open, the part leaves the line: no dot before nothing.
              hasSource ? (
                // With its words as children the hit area grows only down, so it never covers the page link on the
                // line above when the line wraps.
                <SeoSource
                  key="source"
                  named
                  observationId={action.observationId}
                  workspace={model.data}
                >
                  {t("timeline.viewResults")}
                </SeoSource>
              ) : null,
            ],
          ]}
        />
      </div>
      {/* The body gives up its room first, down to a floor: on a very short screen the whole dialog scrolls, so
          the buttons at the foot stay in reach. */}
      <div className="min-h-32 space-y-6 overflow-y-auto px-6 py-5 text-sm">
        {action.decision && (
          <h3 className="font-semibold" lang="en">
            {report("actions.why")}
          </h3>
        )}
        <p
          lang="en"
          className={cn(
            "rounded-md border-s-4 px-4 py-3 whitespace-pre-wrap break-words",
            tint.fill,
            tint.edge,
          )}
        >
          {finding}
          {problem?.footnote ? ` ${problem.footnote}` : null}
        </p>
        {/* The change comes first after the finding: it is what the owner acts on. Before and after stack, so a
            long title reads on whole lines and the two boxes start at the same edge. */}
        {overview.hasMeasuredGoal(action) && model.data.landingPages && (
          <DetailPart title={report("actions.priorityReason")}>
            <p>
              {report("actions.measuredGoal", {
                from: model.data.landingPages.from,
                to: model.data.landingPages.to,
              })}
            </p>
          </DetailPart>
        )}
        {action.impact && <SeoActionImpact impact={action.impact} />}
        {action.followUpReview && (
          <DetailPart title={report("actions.reviewAgain")}>
            <p lang="en">{seoFollowUpText(action.followUpReview, report)}</p>
            {!("beforePeriod" in action.followUpReview) &&
              action.followUpReview.baselineObservationId !==
                action.observationId && (
                <SeoSource
                  named
                  observationId={action.followUpReview.baselineObservationId}
                  workspace={model.data}
                >
                  {report("actions.originalMeasurement")}
                </SeoSource>
              )}
            {!("beforePeriod" in action.followUpReview) && (
              <SeoSource
                named
                observationId={action.followUpReview.observationId}
                workspace={model.data}
              >
                {report("actions.laterMeasurement")}
              </SeoSource>
            )}
          </DetailPart>
        )}
        {action.edit ? (
          <DetailPart title={report("actions.change")}>
            <div className="space-y-3">
              {action.edit.target.trim() ? (
                <ChangeBox label={report("actions.copyTarget")}>
                  <p
                    dir="auto"
                    lang=""
                    className="text-sm whitespace-pre-wrap break-words"
                  >
                    {action.edit.target}
                  </p>
                </ChangeBox>
              ) : null}
              <ChangeBox label={report("actions.before")}>
                <pre
                  dir="auto"
                  lang={action.edit.before?.trim() ? "" : "en"}
                  className="bg-muted text-muted-foreground rounded-md p-3 text-xs whitespace-pre-wrap break-words"
                >
                  {action.edit.before?.trim()
                    ? action.edit.before
                    : report("actions.noBefore")}
                </pre>
              </ChangeBox>
              <ChangeBox
                label={report("actions.after")}
                copy={
                  <SeoCopyButton
                    text={action.edit.after}
                    label={t("actions.copyFix")}
                    className="h-7"
                  />
                }
              >
                <pre
                  dir="auto"
                  lang=""
                  className="bg-chart-3-quinary border-chart-3 rounded-md border p-3 text-xs whitespace-pre-wrap break-words"
                >
                  {action.edit.after}
                </pre>
              </ChangeBox>
            </div>
          </DetailPart>
        ) : null}
        {action.bodyDraft ? (
          <DetailPart title={report("actions.draft")}>
            {"after" in action.bodyDraft ? (
              <div className="space-y-3">
                <ChangeBox label={report("actions.draftBefore")}>
                  <pre
                    dir="auto"
                    lang=""
                    className="bg-muted text-muted-foreground rounded-md p-3 text-xs whitespace-pre-wrap break-words"
                  >
                    {action.bodyDraft.before}
                  </pre>
                </ChangeBox>
                <ChangeBox
                  label={report("actions.draftAfter")}
                  copy={
                    <SeoCopyButton
                      text={action.bodyDraft.after}
                      label={t("actions.copyDraft")}
                      className="h-7"
                    />
                  }
                >
                  <pre
                    dir="auto"
                    lang=""
                    className="bg-chart-3-quinary border-chart-3 rounded-md border p-3 text-xs whitespace-pre-wrap break-words"
                  >
                    {action.bodyDraft.after}
                  </pre>
                </ChangeBox>
                <p lang="en" className="text-muted-foreground text-xs">
                  {report("actions.draftNote")}
                </p>
              </div>
            ) : (
              <p lang="en" className="whitespace-pre-wrap break-words">
                {report("actions.draftHeldBack", {
                  reason: action.bodyDraft.heldBack,
                })}
              </p>
            )}
          </DetailPart>
        ) : null}
        {/* The impact chip already names the kind of rule; the part keeps to the reason of this action. A
            suggestion says what it is not: no error, and no promise of traffic. */}
        {action.decision ? (
          <>
            <DetailPart title={report("actions.alternative")}>
              <p lang="en" className="whitespace-pre-wrap break-words">
                {action.decision.alternative}
              </p>
            </DetailPart>
            <DetailPart title={report("actions.nextCheck")}>
              <p lang="en" className="whitespace-pre-wrap break-words">
                {action.decision.nextCheck}
              </p>
            </DetailPart>
          </>
        ) : (
          <DetailPart title={report("actions.why")}>
            {action.kind === "opportunity" && !severity ? (
              <p lang="en" className="text-muted-foreground">
                {report("actions.opportunitiesHelp")}
              </p>
            ) : null}
            <p lang="en" className="whitespace-pre-wrap break-words">
              {action.why}
            </p>
          </DetailPart>
        )}
        {problem ? (
          <DetailPart title={report("actions.effect")}>
            <p lang="en" className="whitespace-pre-wrap break-words">
              {action.expectedEffect}
            </p>
          </DetailPart>
        ) : null}
        {action.evidence.length ? (
          <DetailPart title={report("actions.evidence")}>
            {observations.length > 0 && (
              <ul className="divide-y rounded-md border">
                {observations.map((line, index) => (
                  <li
                    lang=""
                    dir="auto"
                    key={`${index}:${line}`}
                    className="text-muted-foreground px-3 py-2 text-xs break-words"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {references.length > 0 && (
              <details>
                <SeoFoldSummary className="text-muted-foreground min-h-10 w-fit text-sm">
                  {report("actions.sourceRecords", {
                    count: references.length,
                  })}
                </SeoFoldSummary>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  {references.map((ref, index) => (
                    <li key={index}>
                      <code className="break-all">{ref}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </DetailPart>
        ) : null}
        {page && <SeoBriefPagePriority model={model} pageId={page.id} />}
        {followUp ? (
          <SeoBriefFollowUp
            followUp={followUp}
            strategyCompletedAt={
              action.decision &&
              action.status === "implemented" &&
              action.taskId
                ? action.completedAt
                : undefined
            }
          />
        ) : null}
      </div>
      {/* On a phone the buttons fill the width, the main one on top; from sm they sit at the end of one line, the
          main one last. The order in the DOM is the order on a phone, so the focus order matches what shows. */}
      <div className="bg-senary flex flex-col gap-2 border-t px-6 py-4 sm:flex-row-reverse sm:justify-start">
        {action.followUpReview && model.data.availableActions.canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={model.pending}
            onClick={() => void model.acknowledgeReview(action)}
          >
            {t("actions.markReviewed")}
          </Button>
        )}
        <SeoActionTaskButton action={action} model={model} />
        {action.status !== "needs_review" && (
          <SeoCopyButton
            text={instructions}
            label={t("actions.copyInstructions")}
          />
        )}
      </div>
    </>
  );
}

/** A fact over the action's title. All chips share one height, so the line does not step. */
function Chip({
  title,
  className,
  mark,
  children,
}: {
  title?: string;
  className?: string;
  /** The colour class of a dot before the words, as the impact label has. */
  mark?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        className,
      )}
    >
      {mark ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", mark)}
        />
      ) : null}
      {/* The ellipsis needs a block of text: a flex box cuts its text with none. */}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** One side of the change: its label row has the height of the copy button, with or without one. */
function ChangeBox({
  label,
  copy,
  children,
}: {
  label: string;
  copy?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <p lang="en" className="text-muted-foreground text-xs font-medium">
          {label}
        </p>
        {copy}
      </div>
      {children}
    </div>
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
      <h3 lang="en" className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
