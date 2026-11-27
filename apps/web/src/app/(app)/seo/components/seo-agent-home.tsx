"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { useSeoAgentLeadFocusRecovery } from "@/hooks/effects/use-seo-agent-lead-focus-recovery";
import { useSeoAgentVerdictFocus } from "@/hooks/effects/use-seo-agent-verdict-focus";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoAgentFigures } from "./seo-agent-figures";
import { SeoAgentGraphics } from "./seo-agent-graphics";
import {
  type SeoAgentBrief,
  type SeoAgentStep,
  seoActionHeadline,
  seoAgentBrief,
} from "./seo-agent-model";
import { SeoAgentStatistics } from "./seo-agent-statistics";
import {
  SeoActionDialog,
  SeoActionStepRow,
  SeoActionsLinkRow,
  SeoStepRow,
} from "./seo-agent-steps";
import { currentDiscoveryResult } from "./seo-audit-discovery";
import { useSeoChatIdentity } from "./seo-chat-panel";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoAutomation } from "./seo-monitors";
import { seoOverviewModel } from "./seo-overview-model";
import { seoRarelyShown } from "./seo-performance-model";
import { SeoPlanMessage } from "./seo-plan-message";
import { seoPlanMessage } from "./seo-plan-message-model";
import { SeoPlanPdfLink } from "./seo-plan-pdf-link";
import { SeoPropertyPerformance } from "./seo-property-performance";
import { SeoReportPlan } from "./seo-report-plan";
import { SeoRunDiffCard } from "./seo-run-diff-card";
import { seoRunDiffOf } from "./seo-run-diff-model";
import { seoRunsDateCheck } from "./seo-runs-model";
import { SeoCheckRunning, SeoSetupCard } from "./seo-setup";
import { seoCheckRunning, seoRunAction } from "./seo-setup-model";
import { SEO_ROW_LIST_CLASS, SeoDate } from "./seo-shared";
import { seoSearchTraffic } from "./seo-statistics-model";
import { SeoStrategyLine } from "./seo-strategy";
import { lastRuleCheck, seoSummary } from "./seo-summary-model";
import { seoWorklistEvidence } from "./seo-worklist-evidence";
import { useSelectedSeoPlan } from "./use-selected-seo-plan";
import { useSeoAnalyticsLine } from "./use-seo-analytics-line";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

/** The SEO agent is the first thing on an Audit: what it knows and what it proposes. */
export function SeoAgentHome({ model }: { model: SeoWorkspaceModel }) {
  const [now] = useState(() => new Date());
  const brief = seoAgentBrief(model.data, now);
  // Upkeep lives outside the keyed panel, so a session that finishes loading does not restart it.
  const statisticsSync = model.statisticsSync;
  // Keyed by viewer and Audit, so a changed account starts with its own view state.
  const identity = useSeoChatIdentity(model);
  return (
    <SeoAgentPanel
      key={identity}
      model={model}
      brief={brief}
      statisticsSync={statisticsSync}
    />
  );
}

function SeoAgentPanel({
  model,
  brief,
  statisticsSync,
}: {
  model: SeoWorkspaceModel;
  brief: SeoAgentBrief;
  statisticsSync: SeoWorkspaceModel["statisticsSync"];
}) {
  const t = useTranslations("App.Seo");
  const analyticsLine = useSeoAnalyticsLine(
    model,
    brief.steps.some(
      (step) => step.kind === "connect" && step.provider === "ga4",
    ),
  );
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  // "No issues" holds only for the newest check, and only if it measured something.
  const lastCheckMeasured = (brief.lastCheck?.checked ?? 0) > 0;
  // The written plan and the verdict card both show one: the plan takes the place of the card.
  const runDiffFold = (id: string | undefined) => {
    const diff = seoRunDiffOf(model.data, id);
    return diff ? <SeoRunDiffCard diff={diff} /> : null;
  };
  const check = lastRuleCheck(model.data);
  const runsShown = seoRunsDateCheck(
    model.data,
    model.filters,
    check?.id ?? null,
  );
  // How the pages do in search sits next to whether they are healthy.
  const auditReport =
    !model.filters.pageId &&
    !model.filters.scopeId &&
    !model.filters.from &&
    check?.sourceTaskId
      ? model.data.auditSearchConsole?.find(
          (row) => row.taskId === check.sourceTaskId && row.propertyTotals,
        )
      : undefined;
  const traffic = auditReport ? null : seoSearchTraffic(model.data.metrics);
  const rarelyShown = Boolean(
    traffic && seoRarelyShown(traffic.impressions, traffic.period),
  );
  // Before the first check the setup card leads; a filtered view has its own empty state.
  const setup = model.setup;
  const checkRunning = seoCheckRunning(model.data);
  // A check that ran during this visit: its end is news for a screen reader.
  const [checkSeen, setCheckSeen] = useState(checkRunning);
  if (checkRunning && !checkSeen) setCheckSeen(true);
  // The button that started the check leaves with the setup card. Focus that
  // fell to the page moves to the result; focus anywhere else is left alone.
  const verdict = useRef<HTMLHeadingElement>(null);
  useSeoAgentVerdictFocus(verdict, checkSeen, checkRunning);
  // The action whose card is open in the dialog. It is read from the data, so a Task for it shows in the card.
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const dialogRow = useRef<HTMLButtonElement | null>(null);
  const dialogAction = dialogKey
    ? model.data.actions.find((action) => seoActionKey(action) === dialogKey)
    : undefined;
  // An action that leaves the data closes its dialog for good: a later refetch that brings it back opens nothing.
  if (dialogKey && !dialogAction) setDialogKey(null);
  const openAction = (
    action: Parameters<typeof seoActionKey>[0],
    button: HTMLButtonElement,
  ) => {
    dialogRow.current = button;
    setDialogKey(seoActionKey(action));
  };
  // Missing search statistics are a banner over the result, not one of the steps.
  const statisticsStep = brief.steps.find(
    (step) => step.kind === "connect" && step.provider === "search_console",
  );
  // Google Analytics has its own line at the top of the tab, with the statistics settings.
  const analyticsStep = brief.steps.find(
    (step): step is Extract<SeoAgentStep, { kind: "connect" }> =>
      step.kind === "connect" && step.provider === "ga4",
  );
  // Until the first check has a result, the setup card is the one thing to do: no step shows with it. A failed
  // sync has its alert and Retry in the verdict card, so the refresh step would say it twice.
  const selectedPlan = useSelectedSeoPlan(model);
  const { actionSeverity, actions } = seoOverviewModel(model.data);
  // The plan the SEO worker wrote for the report in view. It takes the place of the plan block and of the verdict
  // with its figures and its actions. An earlier report keeps the plan block: its actions may be gone.
  const message =
    setup || selectedPlan.historical
      ? null
      : seoPlanMessage(model.data, selectedPlan.report, actionSeverity);
  const steps = setup
    ? []
    : brief.steps.filter(
        (step) =>
          !(
            step.kind === "action" &&
            // The written plan names its actions and counts the rest.
            (message || selectedPlan.actionKeys.has(seoActionKey(step.action)))
          ) &&
          step !== statisticsStep &&
          step !== analyticsStep &&
          !(step.kind === "refresh" && statisticsSync.state === "failed"),
      );
  // The first proposal with its own button is the lead step. An action shows as a row with its finding and its
  // tinted draft button; any other step carries the one brand fill of the tab (owner, after pass 59). The run
  // keeps the secondary look. A refresh step has no button of its own: its retry is in the verdict card.
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const primary = setup?.next
    ? -1
    : steps.findIndex((step) =>
        step.kind === "competitors"
          ? canEdit && (canRequestAnalysis || !step.available)
          : step.kind === "strategy" || step.kind === "refresh"
            ? false
            : step.kind !== "action" || (canEdit && !step.action.taskId),
      );
  // The lead step opens the list of steps in the verdict card. With a written plan there is no verdict card.
  const lead = message || primary === -1 ? undefined : steps[primary];
  // A Task for the lead action takes it out of the card, and its button with it. Focus that fell to the
  // page moves to the verdict, where the next first step now stands.
  const leadKey = lead
    ? lead.kind === "action"
      ? lead.action.id
      : lead.kind
    : null;
  // Only focus that was in the list of steps counts: a page nobody has entered also has its focus on the body.
  const leadFocused = useSeoAgentLeadFocusRecovery(verdict, leadKey);
  const periodId = useId();
  const numbers = seoSummary(model.data);
  // The headline counts the rows of the list under it: an issue count beside more rows would not add up.
  const headline = seoActionHeadline(steps, actionSeverity);
  const headlineSplit = headline.parts.length
    ? `: ${reportFormat.list(
        headline.parts.map((part) =>
          report("summary.severityCount", {
            count: part.count,
            severity: part.severity,
          }),
        ),
      )}`
    : "";
  // The headline carries the severities, so the Agent tab needs no issues tile.
  const severitySplit = numbers.issues?.parts.length
    ? `: ${reportFormat.list(
        numbers.issues.parts.map((part) =>
          report("summary.severityCount", {
            count: part.count,
            severity: part.severity,
          }),
        ),
      )}`
    : "";
  const evidence = seoWorklistEvidence(
    model.data,
    currentDiscoveryResult(
      model.data,
      Boolean(model.filters.pageId || model.filters.scopeId),
    ),
    actions,
    report,
  ).filter((item) => !item.strategy && !item.place);
  // During setup the banner waits until the first check runs: then the statistics are the next useful thing.
  // The setup card now keeps its own Google control while a check runs; the banner waits until setup ends.
  const banner =
    statisticsStep?.kind === "connect" && !setup ? (
      <SeoStepRow
        banner={t("agent.statisticsMissing")}
        step={statisticsStep}
        model={model}
        // The banner carries the filled button only where no step does.
        first={primary === -1}
      />
    ) : null;
  const stepItem = (step: SeoAgentStep, index: number) =>
    step.kind === "action" ? (
      <SeoActionStepRow
        key={`${step.action.observationId}:${step.action.id}`}
        action={step.action}
        severity={actionSeverity(step.action)}
        model={model}
        lead={index === primary}
        onOpen={(row) => {
          dialogRow.current = row;
          setDialogKey(seoActionKey(step.action));
        }}
      />
    ) : step.kind === "strategy" ? (
      <SeoActionsLinkRow key="strategy" model={model}>
        {report("agent.steps.strategy", {
          count: step.count,
          places: step.places ? "yes" : "no",
        })}
      </SeoActionsLinkRow>
    ) : (
      <SeoStepRow
        key={`${step.kind}:${"provider" in step ? step.provider : ""}`}
        step={step}
        model={model}
        first={index === primary}
        flush={index === primary}
      />
    );
  const trafficLine = traffic
    ? report("agent.traffic", {
        impressions: traffic.impressions,
        clicks: traffic.clicks,
        // Every Search Console read is filtered to the Audit's pages.
        pages: model.data.scope.pageIds.length,
      })
    : null;
  // The search numbers are the headline where nothing else can be: no result, and no check to run.
  const trafficLead =
    Boolean(trafficLine) &&
    !canRequestAnalysis &&
    !brief.lastCheck &&
    !brief.issues &&
    !brief.fixes &&
    !brief.opportunities;
  // No check has saved a result in this view, and the reader can run one.
  const firstCheck =
    !brief.lastCheck &&
    !brief.ruleCheckOutsideSelection &&
    !seoRunAction(model.data) &&
    !model.waitingForGoogle &&
    canRequestAnalysis &&
    !model.filters.from &&
    !model.filters.to;
  const upkeep =
    statisticsSync.state === "loading" ? (
      <p role="status" className="text-muted-foreground text-sm">
        {t("agent.refreshing")}
      </p>
    ) : statisticsSync.state === "failed" ? (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-destructive">{t("agent.refreshFailed")}</p>
        <Button size="sm" variant="outline" onClick={statisticsSync.retry}>
          {t("retry")}
        </Button>
      </div>
    ) : null;
  return (
    <section
      aria-labelledby="seo-agent-title"
      className={cn(HOLDER_CLASS, "min-w-0 space-y-3")}
    >
      {/* The tab says "Agent": the name is for the landmark only. */}
      <h2 id="seo-agent-title" className="sr-only">
        {t("agent.title")}
      </h2>
      {/* Present before a check starts, so its start and end are announced. */}
      <p role="status" className="sr-only">
        {checkRunning
          ? t("setup.checkRunningBadge")
          : checkSeen
            ? t("setup.checkEnded")
            : ""}
      </p>
      {/* First on the tab, in one place on every width: a move would remount the control and drop an approval in flight. */}
      {banner}
      {analyticsStep && !setup ? (
        <SeoAgentStatistics model={model} line={analyticsLine} />
      ) : null}
      {/* The pictures come first: the keyword searches say what the site can win before the verdict says
          what to fix. */}
      {setup ? null : <SeoAgentGraphics model={model} />}
      {setup ? null : message ? (
        <SeoPlanMessage
          selected={selectedPlan}
          model={model}
          message={message}
          titleRef={verdict}
          onOpen={openAction}
          pdf={
            selectedPlan.report?.sourceTaskId ? (
              <SeoPlanPdfLink
                key={selectedPlan.report.id}
                model={model}
                taskId={selectedPlan.report.sourceTaskId}
                observedAt={selectedPlan.report.observedAt}
              />
            ) : null
          }
          status={
            <>
              <SeoCheckRunning workspace={model.data} />
              {upkeep}
            </>
          }
          figures={
            <>
              {/* The plan stays on its audit after a newer focused check: it compares its own check. */}
              {runDiffFold(selectedPlan.report?.id)}
              {auditReport && <SeoPropertyPerformance evidence={auditReport} />}
              <SeoAgentFigures
                model={model}
                traffic={traffic}
                periodId={periodId}
                trafficLead={false}
              />
            </>
          }
        />
      ) : (
        <SeoReportPlan
          selected={selectedPlan}
          model={model}
          onOpen={openAction}
        />
      )}
      {setup ? (
        <SeoSetupCard model={model} setup={setup} />
      ) : message ? null : (
        <div className={cn(HOLDER_ITEM_CLASS, "content-rise space-y-2 p-4")}>
          <h3
            lang="en"
            ref={verdict}
            tabIndex={-1}
            className="focus-visible:outline-ring rounded-sm text-lg font-semibold text-balance focus-visible:outline-2"
            data-testid="seo-agent-verdict"
            // The search numbers alone name no period; the line under them does.
            aria-describedby={trafficLead ? periodId : undefined}
          >
            {headline.count
              ? headline.suggestions
                ? report("agent.verdict.waiting", { count: headline.count })
                : `${report("agent.verdict.actions", { count: headline.count })}${headlineSplit}`
              : // No row to fix them under the headline: it says what the check found, not what to do.
                brief.issues
                ? `${report("agent.verdict.issuesFound", { count: brief.issues })}${severitySplit}`
                : brief.fixes
                  ? report("agent.verdict.fixes", { count: brief.fixes })
                  : brief.opportunities
                    ? report("agent.verdict.waiting", {
                        count: brief.opportunities,
                      })
                    : brief.earlierIssues
                      ? report("overview.earlierFindings", {
                          count: brief.earlierIssues,
                        })
                      : brief.checkClear && lastCheckMeasured
                        ? rarelyShown
                          ? report("agent.verdict.clearRarelyShown", {
                              pages: brief.lastCheck?.pages ?? 1,
                            })
                          : report("agent.verdict.clear")
                        : brief.lastCheck
                          ? report("actions.checksIncomplete")
                          : brief.ruleCheckOutsideSelection
                            ? report("agent.verdict.noPageCheckInView")
                            : // No call to run a check where no check can run: lead with what is known.
                              canRequestAnalysis
                              ? report("agent.verdict.noCheck")
                              : trafficLead
                                ? trafficLine
                                : report("agent.verdict.noCheckOff")}
          </h3>
          {/* The runs row over the tabs names the day of the check in view. */}
          {brief.lastCheck && !runsShown ? (
            <p lang="en" className="text-muted-foreground text-sm">
              {report("agent.lastCheckOn")}{" "}
              <SeoDate report day value={brief.lastCheck.at} />
            </p>
          ) : null}
          {runDiffFold(brief.lastCheck?.id)}
          <SeoStrategyLine strategy={model.data.strategy} />
          {auditReport && <SeoPropertyPerformance evidence={auditReport} />}
          <SeoAgentFigures
            model={model}
            traffic={traffic}
            periodId={periodId}
            trafficLead={trafficLead}
          />
          {firstCheck ? (
            // A narrowed view has no setup card, so the first check starts
            // here. The button stays while its check runs, so keyboard
            // focus stays too.
            <Button
              size="sm"
              variant="outline"
              // Not the disabled attribute: that drops focus from the button.
              aria-disabled={checkRunning || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => {
                if (!checkRunning) model.setDialog("analysis");
              }}
            >
              <Play />
              {t("runAnalysis")}
            </Button>
          ) : null}
          <SeoCheckRunning workspace={model.data} />
          {upkeep}
          {lead ? (
            // The verdict and its steps are one card: the headline says what is wrong, and every step follows
            // it in one list. The first step leads, with its button.
            <ul
              role="list"
              aria-label={report("agent.nextTitle")}
              className={cn(
                SEO_ROW_LIST_CLASS,
                "-mx-4 -mb-4 rounded-none rounded-b-lg border-0 border-t bg-transparent [&>li:first-child]:rounded-t-none [&>li:first-child>button]:rounded-t-none",
              )}
              onFocus={() => {
                leadFocused.current = true;
              }}
              onBlur={(event) => {
                // Focus that moved on, or went to the page by a click, has left. Focus whose element is gone,
                // or whose window lost focus, still counts as in the list.
                if (
                  event.relatedTarget ||
                  (document.hasFocus() && event.target.isConnected)
                )
                  leadFocused.current = false;
              }}
            >
              {stepItem(lead, primary)}
              {steps.map((step, index) =>
                index === primary ? null : stepItem(step, index),
              )}
            </ul>
          ) : null}
        </div>
      )}
      {/* The setup card has no line for upkeep, so it sits under the card. */}
      {setup && upkeep ? <div className="px-2">{upkeep}</div> : null}
      {!setup && !model.data.observations.length ? (
        <SeoGettingStarted model={model} />
      ) : null}
      {/* With a first step, every step is in the verdict card. Without one, the list shows open under the
          verdict card. */}
      {lead || ((setup || banner) && !steps.length) ? null : steps.length ? (
        <div className="space-y-2">
          {/* The verdict names the issues its steps fix. A written plan has no verdict, so the list has its title. */}
          {(headline.count || brief.issues) && !message ? null : (
            <h3 lang="en" className="px-2 text-sm font-semibold">
              {report("agent.nextTitle")}
            </h3>
          )}
          <ul
            role="list"
            aria-label={report("agent.nextTitle")}
            className={SEO_ROW_LIST_CLASS}
          >
            {steps.map((step, index) => stepItem(step, index))}
          </ul>
        </div>
      ) : message ||
        selectedPlan.plan ||
        (analyticsStep &&
          (!analyticsLine.hidden || analyticsLine.analytics !== "unknown")) ||
        statisticsSync.state === "failed" ||
        evidence.length ? null : (
        // The Analytics line, a sync that runs or failed, each still ask for something: "nothing is waiting"
        // would be wrong. Only a hidden line with no cause to name asks for nothing.
        <p lang="en" className="text-muted-foreground max-w-prose px-2 text-sm">
          {report("agent.nothingNext")}
        </p>
      )}
      {!setup && evidence.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void model.setFilters({ tab: "actions" })}
        >
          {t("agent.reviewEvidence", { count: evidence.length })}
        </Button>
      )}
      <SeoAutomation model={model} />
      <SeoActionDialog
        action={dialogAction}
        severity={dialogAction ? actionSeverity(dialogAction) : null}
        model={model}
        onClose={() => setDialogKey(null)}
        onCloseAutoFocus={(event) => {
          // Focus goes back to the row; a row that left with its Task gives it to the verdict.
          event.preventDefault();
          const row = dialogRow.current;
          (row?.isConnected ? row : verdict.current)?.focus();
        }}
      />
    </section>
  );
}
