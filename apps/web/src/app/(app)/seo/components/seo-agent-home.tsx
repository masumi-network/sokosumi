"use client";

import { ChevronDown, Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoAgentFigures } from "./seo-agent-figures";
import { SeoAgentGraphics } from "./seo-agent-graphics";
import {
  type SeoAgentBrief,
  type SeoAgentStep,
  seoAgentBrief,
} from "./seo-agent-model";
import { SeoAgentStatistics } from "./seo-agent-statistics";
import {
  SeoActionDialog,
  SeoActionStepRow,
  SeoActionsLinkRow,
  SeoStepRow,
} from "./seo-agent-steps";
import { useSeoChatIdentity } from "./seo-chat-panel";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoAutomation } from "./seo-monitors";
import { seoOverviewModel } from "./seo-overview-model";
import { seoRarelyShown } from "./seo-performance-model";
import { seoRunsDateCheck } from "./seo-runs-model";
import { SeoCheckRunning, SeoSetupCard } from "./seo-setup";
import { seoCheckRunning } from "./seo-setup-model";
import { SEO_ROW_LIST_CLASS, SeoDate } from "./seo-shared";
import { seoSearchTraffic } from "./seo-statistics-model";
import { SeoStrategyLine } from "./seo-strategy";
import { lastRuleCheck, seoSummary } from "./seo-summary-model";
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
  const format = useFormatter();
  // "No issues" holds only for the newest check, and only if it measured something.
  const lastCheckMeasured = (brief.lastCheck?.checked ?? 0) > 0;
  const runsShown = seoRunsDateCheck(
    model.data,
    model.filters,
    lastRuleCheck(model.data)?.id ?? null,
  );
  // How the pages do in search sits next to whether they are healthy.
  const traffic = seoSearchTraffic(model.data.metrics);
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
  useEffect(() => {
    if (checkSeen && !checkRunning && document.activeElement === document.body)
      verdict.current?.focus();
  }, [checkSeen, checkRunning]);
  // The action whose card is open in the dialog. It is read from the data, so a Task for it shows in the card.
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const dialogRow = useRef<HTMLButtonElement | null>(null);
  const dialogAction = dialogKey
    ? model.data.actions.find((action) => seoActionKey(action) === dialogKey)
    : undefined;
  // An action that leaves the data closes its dialog for good: a later refetch that brings it back opens nothing.
  if (dialogKey && !dialogAction) setDialogKey(null);
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
  const steps = setup
    ? []
    : brief.steps.filter(
        (step) =>
          step !== statisticsStep &&
          step !== analyticsStep &&
          !(step.kind === "refresh" && statisticsSync.state === "failed"),
      );
  const [showAllSteps, setShowAllSteps] = useState(false);
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
  // The lead step sits in the verdict card, with the rest folded under it.
  const lead = primary === -1 ? undefined : steps[primary];
  // A Task for the lead action takes it out of the card, and its button with it. Focus that fell to the
  // page moves to the verdict, where the next first step now stands.
  const leadKey = lead
    ? lead.kind === "action"
      ? lead.action.id
      : lead.kind
    : null;
  // Only focus that was in the lead list counts: a page nobody has entered also has its focus on the body.
  const leadSeen = useRef(leadKey);
  const leadFocused = useRef(false);
  useEffect(() => {
    if (leadSeen.current === leadKey) return;
    leadSeen.current = leadKey;
    if (leadFocused.current && document.activeElement === document.body)
      verdict.current?.focus();
    leadFocused.current = false;
  }, [leadKey]);
  const periodId = useId();
  const numbers = seoSummary(model.data);
  // The headline carries the severities, so the Agent tab needs no issues tile.
  const severitySplit = numbers.issues
    ? `: ${format.list(
        numbers.issues.parts.map((part) =>
          t("summary.severityCount", {
            count: part.count,
            severity: part.severity,
          }),
        ),
      )}`
    : "";
  const { actionSeverity } = seoOverviewModel(model.data);
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
        {t("agent.steps.strategy", {
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
    ? t("agent.traffic", {
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
        <SeoAgentStatistics step={analyticsStep} model={model} />
      ) : null}
      {setup ? (
        <SeoSetupCard model={model} setup={setup} />
      ) : (
        <div className={cn(HOLDER_ITEM_CLASS, "content-rise space-y-2 p-4")}>
          <h3
            ref={verdict}
            tabIndex={-1}
            className="focus-visible:outline-ring rounded-sm text-lg font-semibold text-balance focus-visible:outline-2"
            data-testid="seo-agent-verdict"
            // The search numbers alone name no period; the line under them does.
            aria-describedby={trafficLead ? periodId : undefined}
          >
            {brief.issues
              ? `${t("agent.verdict.issues", { count: brief.issues })}${severitySplit}`
              : brief.fixes
                ? t("agent.verdict.fixes", { count: brief.fixes })
                : brief.opportunities
                  ? t("agent.verdict.waiting", { count: brief.opportunities })
                  : brief.emptyState === "no_fixes" && lastCheckMeasured
                    ? rarelyShown
                      ? t("agent.verdict.clearRarelyShown", {
                          pages: brief.lastCheck?.pages ?? 1,
                        })
                      : t("agent.verdict.clear")
                    : brief.lastCheck
                      ? t("actions.checksIncomplete")
                      : // No call to run a check where no check can run: lead with what is known.
                        canRequestAnalysis
                        ? t("agent.verdict.noCheck")
                        : trafficLead
                          ? trafficLine
                          : t("agent.verdict.noCheckOff")}
          </h3>
          {/* The runs row over the tabs names the day of the check in view. */}
          {brief.lastCheck && !runsShown ? (
            <p className="text-muted-foreground text-sm">
              {t("agent.lastCheckOn")}{" "}
              <SeoDate day value={brief.lastCheck.at} />
            </p>
          ) : null}
          <SeoStrategyLine strategy={model.data.strategy} />
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
            // The verdict and its steps are one card: the headline says what is wrong, the first step under it
            // what to do first, and the other steps wait behind one press right under that step.
            <div className="-mx-4 -mb-4 border-t">
              <ul
                role="list"
                aria-label={t("agent.firstStep")}
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
              </ul>
              {steps.length > 1 ? (
                <Collapsible open={showAllSteps} onOpenChange={setShowAllSteps}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground h-10 w-full justify-start rounded-none border-t px-4 data-[state=closed]:rounded-b-lg"
                    >
                      {showAllSteps
                        ? t("overview.showLess")
                        : t("agent.moreSteps", { count: steps.length - 1 })}
                      <ChevronDown
                        className={cn(
                          "transition-transform duration-150 ease-out motion-reduce:transition-none",
                          showAllSteps && "rotate-180",
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  {/* The rows open under the press, in reading order: the press stays right under the first step. */}
                  <CollapsibleContent>
                    <ul
                      role="list"
                      aria-label={t("agent.nextTitle")}
                      className={cn(
                        SEO_ROW_LIST_CLASS,
                        "rounded-none border-0 border-t bg-transparent [&>li:first-child]:rounded-t-none [&>li:first-child>button]:rounded-t-none",
                      )}
                    >
                      {steps.map((step, index) =>
                        index === primary ? null : stepItem(step, index),
                      )}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {/* The setup card has no line for upkeep, so it sits under the card. */}
      {setup && upkeep ? <div className="px-2">{upkeep}</div> : null}
      {!setup && !model.data.observations.length ? (
        <SeoGettingStarted model={model} />
      ) : null}
      {setup ? null : <SeoAgentGraphics model={model} />}
      {/* With a first step, every step is in the verdict card. Without one nothing is above the list, so it
          shows open under the pictures. */}
      {lead || ((setup || banner) && !steps.length) ? null : steps.length ? (
        <div className="space-y-2">
          {brief.issues ? null : (
            <h3 className="px-2 text-sm font-semibold">
              {t("agent.nextTitle")}
            </h3>
          )}
          <ul
            role="list"
            aria-label={t("agent.nextTitle")}
            className={SEO_ROW_LIST_CLASS}
          >
            {steps.map((step, index) => stepItem(step, index))}
          </ul>
        </div>
      ) : analyticsStep || statisticsSync.state === "failed" ? null : (
        // The Analytics line and a failed sync each still ask for something: "nothing is waiting" would be wrong.
        <p className="text-muted-foreground max-w-prose px-2 text-sm">
          {t("agent.nothingNext")}
        </p>
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
