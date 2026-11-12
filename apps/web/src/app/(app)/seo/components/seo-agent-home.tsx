"use client";

import { ArrowDown, ChevronDown, ChevronRight, Play } from "lucide-react";
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
import { SeoActionStepRow, SeoStepRow } from "./seo-agent-steps";
import { useSeoChatIdentity } from "./seo-chat-panel";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoAutomation } from "./seo-monitors";
import { seoOverviewModel } from "./seo-overview-model";
import { seoRarelyShown } from "./seo-performance-model";
import { SeoCheckRunning, SeoSetupCard } from "./seo-setup";
import { seoCheckRunning, seoRunLeads, seoSetup } from "./seo-setup-model";
import {
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SeoDate,
  SeoPeriod,
} from "./seo-shared";
import { seoSearchTraffic } from "./seo-statistics-model";
import { SeoStrategyLine } from "./seo-strategy";
import { seoSummary } from "./seo-summary-model";
import { SeoSummaryTiles } from "./seo-summary-tiles";
import { useSeoAutopilot } from "./use-seo-autopilot";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Next steps past this count fold behind a "show more" button: three choices are enough to start. */
const SEO_AGENT_VISIBLE_STEPS = 3;

/** The SEO agent is the first thing on an Audit: what it knows and what it proposes. */
export function SeoAgentHome({ model }: { model: SeoWorkspaceModel }) {
  const [now] = useState(() => new Date());
  const brief = seoAgentBrief(model.data, now);
  // Upkeep lives outside the keyed panel, so a session that finishes loading does not restart it.
  const autopilot = useSeoAutopilot(model, brief);
  // Keyed by viewer and Audit, so a changed account starts with its own view state.
  const identity = useSeoChatIdentity(model);
  return (
    <SeoAgentPanel
      key={identity}
      model={model}
      brief={brief}
      autopilot={autopilot}
    />
  );
}

function SeoAgentPanel({
  model,
  brief,
  autopilot,
}: {
  model: SeoWorkspaceModel;
  brief: SeoAgentBrief;
  autopilot: ReturnType<typeof useSeoAutopilot>;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  // "No issues" holds only for the newest check, and only if it measured something.
  const lastCheckMeasured = (brief.lastCheck?.checked ?? 0) > 0;
  // How the pages do in search sits next to whether they are healthy.
  const traffic = seoSearchTraffic(model.data.metrics);
  const rarelyShown = Boolean(
    traffic && seoRarelyShown(traffic.impressions, traffic.period),
  );
  // Before the first check the setup card leads; a filtered view has its own empty state.
  const setup = seoSetup(model.data, model.filters);
  const checkRunning = seoCheckRunning(model.data);
  // A check that ran during this visit: its end is news for a screen reader.
  const [checkSeen, setCheckSeen] = useState(checkRunning);
  if (checkRunning && !checkSeen) setCheckSeen(true);
  // The button that started the check leaves with the setup card. Focus that
  // fell to the page moves to the result; focus anywhere else is left alone.
  const verdict = useRef<HTMLParagraphElement>(null);
  // On a phone the steps start more than one screen under the headline: a line of the result card leads there.
  const stepList = useRef<HTMLHeadingElement>(null);
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
  const shown = showAllSteps ? steps : steps.slice(0, SEO_AGENT_VISIBLE_STEPS);
  // The first proposal with its own button carries the one primary action,
  // unless a setup step or the header's run button holds it.
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const primary =
    setup?.next || seoRunLeads(model.data)
      ? -1
      : shown.findIndex((step) =>
          step.kind === "competitors"
            ? canEdit && (canRequestAnalysis || !step.available)
            : step.kind === "strategy"
              ? false
              : step.kind !== "action" || (canEdit && !step.action.taskId),
        );
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
  // The keyword results as numbers. The issue count is in the headline; its tiles lead the Health tab.
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
  const banner =
    statisticsStep &&
    statisticsStep.kind !== "action" &&
    (!setup || setup.check === "running") ? (
      <SeoStepRow
        banner={t("agent.statisticsMissing")}
        step={statisticsStep}
        model={model}
        // The banner carries the filled button only where no step and no run button does.
        first={primary === -1 && !seoRunLeads(model.data)}
        refresh={() => {
          void autopilot.refresh();
        }}
        refreshing={autopilot.state === "refreshing"}
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
    ) : (
      <SeoStepRow
        key={`${step.kind}:${"provider" in step ? step.provider : ""}`}
        step={step}
        model={model}
        first={index === primary}
        refresh={() => {
          void autopilot.refresh();
        }}
        refreshing={autopilot.state === "refreshing"}
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
    canRequestAnalysis &&
    !model.filters.from &&
    !model.filters.to;
  const upkeep =
    autopilot.state === "refreshing" ? (
      <p role="status" className="text-muted-foreground text-sm">
        {t("agent.refreshing")}
      </p>
    ) : autopilot.state === "failed" ? (
      <p role="alert" className="text-destructive text-sm">
        {t("agent.refreshFailed")}
      </p>
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
          <p
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
          </p>
          {brief.lastCheck ? (
            <p className="text-muted-foreground text-sm">
              {t("agent.lastCheckOn")}{" "}
              <SeoDate day value={brief.lastCheck.at} />
            </p>
          ) : null}
          {primary === -1 ? null : (
            // On a phone the steps start more than one screen down. The headline names the result; this line
            // names the way to its first step. At the end of the card the button hangs into the card's padding,
            // so the card grows little; before another line it keeps the gap of the lines. On a wide screen the
            // line is an empty box that takes back the gap before it: a hidden box would leave that gap at the
            // end of the card.
            <div className="max-sm:last:-mb-2 sm:-mt-2">
              <Button
                variant="ghost"
                size="sm"
                // The words start at the text edge of the card.
                className="-ms-2.5 sm:hidden"
                onClick={() => {
                  stepList.current?.scrollIntoView({
                    block: "start",
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "auto"
                      : "smooth",
                  });
                  // A screen reader goes on from the steps, not from this button.
                  stepList.current?.focus({ preventScroll: true });
                }}
              >
                {t("agent.toSteps")}
                <ArrowDown />
              </Button>
            </div>
          )}
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
        </div>
      )}
      {/* The setup card has no line for upkeep, so it sits under the card. */}
      {setup && upkeep ? <div className="px-2">{upkeep}</div> : null}
      {!setup && !model.data.observations.length ? (
        <SeoGettingStarted model={model} />
      ) : null}
      {/* The numbers and the pictures are one block, in one place on every width. On a wide screen the tiles stand
          one over the other beside the picture, so the first step and its button stay in the first screen. */}
      {setup ? null : (
        <div className="grid gap-2 empty:hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start lg:[&>*:only-child]:col-span-2 lg:[&>dl:not(:only-child)]:grid-cols-1">
          {tiles}
        </div>
      )}
      {(setup || banner) && !steps.length ? null : (
        <div className="space-y-2">
          <h3
            ref={stepList}
            tabIndex={-1}
            className="focus-visible:outline-ring scroll-mt-20 rounded-sm px-2 text-sm font-semibold focus-visible:outline-2"
          >
            {t("agent.nextTitle")}
          </h3>
          {steps.length ? (
            <ul role="list" className={SEO_ROW_LIST_CLASS}>
              {shown.slice(0, split).map(stepItem)}
              {moreActions ? (
                // The Agent tab shows the first actions only: the rest must not look absent.
                <li>
                  <button
                    type="button"
                    className={cn(
                      SEO_ROW_BUTTON_CLASS,
                      "text-muted-foreground px-4 py-2.5 text-sm",
                    )}
                    onClick={() => {
                      void model.setFilters({ tab: "actions" });
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      {t("agent.moreActions", {
                        count: moreActions,
                        kind: actionKind,
                      })}
                    </span>
                    <ChevronRight className="size-4 shrink-0" />
                  </button>
                </li>
              ) : null}
              {shown
                .slice(split)
                .map((step, index) => stepItem(step, index + split))}
            </ul>
          ) : (
            <p className="text-muted-foreground max-w-prose px-2 text-sm">
              {t("agent.nothingNext")}
            </p>
          )}
          {steps.length > SEO_AGENT_VISIBLE_STEPS ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showAllSteps}
              onClick={() => setShowAllSteps((open) => !open)}
            >
              {showAllSteps
                ? t("overview.showLess")
                : t("agent.moreSteps", {
                    count: steps.length - SEO_AGENT_VISIBLE_STEPS,
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
      {/* During setup a schedule is not the next step: show only one that exists. */}
      {setup && !model.data.monitors.length ? null : (
        <SeoAutomation model={model} />
      )}
    </section>
  );
}
