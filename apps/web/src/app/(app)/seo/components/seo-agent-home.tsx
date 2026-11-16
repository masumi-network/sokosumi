"use client";

import { ChevronDown, Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActionCard } from "./seo-actions";
import { SeoAgentGraphics } from "./seo-agent-graphics";
import {
  type SeoAgentBrief,
  type SeoAgentStep,
  seoAgentBrief,
} from "./seo-agent-model";
import {
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
import {
  SEO_ROW_LIST_CLASS,
  SeoDate,
  SeoPeriod,
  seoFoldCount,
} from "./seo-shared";
import { seoSearchTraffic } from "./seo-statistics-model";
import { SeoStrategyLine } from "./seo-strategy";
import { lastRuleCheck, seoSummary } from "./seo-summary-model";
import { SeoSummaryTiles } from "./seo-summary-tiles";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Next steps past this count fold behind a "show more" button: three choices are enough to start. */
const SEO_AGENT_VISIBLE_STEPS = 3;

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
  // Missing search statistics are a banner over the result, not one of the steps.
  const statisticsStep = brief.steps.find(
    (step) => step.kind === "connect" && step.provider === "search_console",
  );
  // Until the first check has a result, the setup card is the one thing to do: no step shows with it.
  const steps = setup
    ? []
    : brief.steps.filter((step) => step !== statisticsStep);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const visibleSteps = seoFoldCount(steps.length, SEO_AGENT_VISIBLE_STEPS);
  const shown = showAllSteps ? steps : steps.slice(0, visibleSteps);
  // The first proposal with its own button is the lead step: an action shows as a card. It carries the one
  // brand fill of the tab (owner, after pass 59); the run keeps the secondary look.
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  // It comes from the steps before the fold, so showing more steps never moves a step into the verdict card.
  const primary = setup?.next
    ? -1
    : steps.slice(0, visibleSteps).findIndex((step) =>
        step.kind === "competitors"
          ? canEdit && (canRequestAnalysis || !step.available)
          : step.kind === "strategy"
            ? false
            : // A refresh has its retry button only after a failed sync.
              step.kind === "refresh"
              ? model.statisticsSync.state === "failed"
              : step.kind !== "action" || (canEdit && !step.action.taskId),
      );
  // The lead step sits in the verdict card; the list under the pictures holds the rest.
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
  // The actions lead the steps. The steps after them get their own list and label.
  const firstOther = shown.findIndex((step) => step.kind !== "action");
  const split = firstOther === -1 ? shown.length : firstOther;
  const moreActions =
    brief.fixes +
    brief.opportunities -
    steps.filter((step) => step.kind === "action").length;
  const actionKind = brief.opportunities ? "action" : "fix";
  // The keyword results as numbers. The issue count is in the headline; its tiles lead the Actions tab.
  const tiles = (
    <>
      <SeoSummaryTiles
        show="rankings"
        workspace={model.data}
        onOpenRankings={() => {
          void model.setFilters({ tab: "rankings" });
        }}
      />
      <SeoAgentGraphics model={model} />
    </>
  );
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
      index === primary ? (
        <li
          className="content-rise"
          key={`${step.action.observationId}:${step.action.id}`}
        >
          <SeoActionCard
            action={step.action}
            model={model}
            severity={actionSeverity(step.action)}
            primary
            fixed
            flush
          />
        </li>
      ) : (
        <SeoActionStepRow
          key={`${step.action.observationId}:${step.action.id}`}
          action={step.action}
          severity={actionSeverity(step.action)}
          model={model}
        />
      )
    ) : step.kind === "strategy" ? (
      <SeoActionsLinkRow key="strategy" model={model} strategy>
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
        {/* A refresh step under it has the retry button already. */}
        {lead?.kind === "refresh" ? null : (
          <Button size="sm" variant="outline" onClick={statisticsSync.retry}>
            {t("retry")}
          </Button>
        )}
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
          {traffic ? (
            // The link is its own item: when it wraps, no separator leads its line.
            <p
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
              data-testid="seo-agent-traffic"
            >
              <span
                id={periodId}
                className={cn(trafficLead && "text-muted-foreground")}
              >
                {trafficLead ? null : `${trafficLine} · `}
                <SeoPeriod from={traffic.period.from} to={traffic.period.to} />
              </span>
              <button
                type="button"
                className="focus-visible:ring-ring -my-3 inline-block rounded-sm py-3 underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => {
                  void model.setFilters({ tab: "traffic" });
                }}
              >
                {t("agent.openTraffic")}
              </button>
            </p>
          ) : null}
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
            // The verdict and its first step are one card: the headline says what is wrong, the step under it
            // what to do first. The other steps follow the pictures.
            <ul
              role="list"
              aria-label={t("agent.firstStep")}
              className="-mx-4 -mb-4 border-t"
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
          ) : null}
        </div>
      )}
      {/* The setup card has no line for upkeep, so it sits under the card. */}
      {setup && upkeep ? <div className="px-2">{upkeep}</div> : null}
      {!setup && !model.data.observations.length ? (
        <SeoGettingStarted model={model} />
      ) : null}
      {/* The numbers and the pictures are one block, in one place on every width. On a wide screen the tiles stand
          one over the other beside the picture, so the first step and its button start as high as they can. The
          two columns are one height: the tiles share the height of the picture, or the picture takes theirs. */}
      {setup ? null : (
        <div className="grid gap-2 empty:hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:[&>*:only-child]:col-span-2 lg:[&>dl:not(:only-child)]:grid-cols-1">
          {tiles}
        </div>
      )}
      {((setup || banner) && !steps.length) ||
      (lead && steps.length === 1 && !moreActions) ? null : (
        <div className="space-y-2">
          {brief.issues ? null : (
            <h3 className="px-2 text-sm font-semibold">
              {t("agent.nextTitle")}
            </h3>
          )}
          {steps.length ? (
            <ul
              role="list"
              aria-label={t("agent.nextTitle")}
              className={SEO_ROW_LIST_CLASS}
            >
              {shown
                .slice(0, split)
                .map((step, index) =>
                  index === primary ? null : stepItem(step, index),
                )}
              {moreActions ? (
                // The Agent tab shows the first actions only: the rest must not look absent.
                <SeoActionsLinkRow model={model}>
                  {t("agent.moreActions", {
                    count: moreActions,
                    kind: actionKind,
                  })}
                </SeoActionsLinkRow>
              ) : null}
              {shown
                .slice(split)
                .map((step, index) =>
                  index + split === primary
                    ? null
                    : stepItem(step, index + split),
                )}
            </ul>
          ) : (
            <p className="text-muted-foreground max-w-prose px-2 text-sm">
              {t("agent.nothingNext")}
            </p>
          )}
          {steps.length > visibleSteps ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showAllSteps}
              onClick={() => setShowAllSteps((open) => !open)}
            >
              {showAllSteps
                ? t("overview.showLess")
                : t("agent.moreSteps", {
                    count: steps.length - visibleSteps,
                  })}
              <ChevronDown
                className={cn(
                  "transition-transform duration-150 ease-out motion-reduce:transition-none",
                  showAllSteps && "rotate-180",
                )}
              />
            </Button>
          ) : null}
        </div>
      )}
      <SeoAutomation model={model} />
    </section>
  );
}
