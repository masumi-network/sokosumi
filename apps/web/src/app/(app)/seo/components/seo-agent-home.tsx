"use client";

import {
  ChevronDown,
  Compass,
  FileText,
  Lightbulb,
  type LucideIcon,
  Play,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Search,
  WandSparkles,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActionCard } from "./seo-actions";
import {
  type SeoAgentBrief,
  type SeoAgentStep,
  seoAgentBrief,
} from "./seo-agent-model";
import { SeoAskBar } from "./seo-ask-bar";
import { useSeoChatIdentity } from "./seo-chat-panel";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoGoogleConnection } from "./seo-google-connection";
import { SeoAutomation } from "./seo-monitors";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import { seoRarelyShown } from "./seo-performance-model";
import { SeoSetupCard } from "./seo-setup";
import { seoCheckRunning, seoRunLeads } from "./seo-setup-model";
import { SeoDate, SeoPageLink, SeoPeriod, SeoSeverity } from "./seo-shared";
import { seoSearchTraffic } from "./seo-statistics-model";
import { SeoStrategyLine } from "./seo-strategy";
import { seoSummary } from "./seo-summary-model";
import { SeoSummaryTiles } from "./seo-summary-tiles";
import { useSeoAutopilot } from "./use-seo-autopilot";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoSetup } from "./use-seo-setup";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Next steps past this count fold behind a "show more" button. */
const SEO_AGENT_VISIBLE_STEPS = 6;
const STEP_ICONS: Record<
  Exclude<SeoAgentStep, { kind: "action" }>["kind"],
  LucideIcon
> = {
  measure: Lightbulb,
  strategy: Compass,
  keyword: Search,
  pages: FileText,
  refresh: RefreshCw,
  connect: Plug,
  // Not the people icon: the chat uses that one for "shared in your organization".
  competitors: Radar,
};

function StepRow({
  step,
  model,
  refresh,
  refreshing,
  first,
}: {
  step: Exclude<SeoAgentStep, { kind: "action" }>;
  model: SeoWorkspaceModel;
  refresh: () => void;
  refreshing: boolean;
  /** The agent's top proposal carries the one primary button. */
  first: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  // Several steps can carry the same button name; the step's text tells them apart.
  const bodyId = useId();
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const variant = first ? "primary" : "outline";
  // A connected account with nothing synced: the step asks for the sync, not for the account.
  // The account's own actions are in the sync dialog.
  const connectStep = step.kind === "connect";
  const sync =
    useSeoConnectionStatus(
      connectStep ? step.provider : "search_console",
      connectStep,
    ).status.data?.status === "connected" && connectStep;
  const [body, control] =
    step.kind === "measure"
      ? [
          // One page needs no URL; with several, the step names its page.
          model.data.scope.pageIds.length > 1
            ? t("agent.steps.measureOnPage", {
                name: step.name,
                value: step.value,
                count: step.tools.length,
                tools: format.list(step.tools),
                url: step.pageUrl,
              })
            : t("agent.steps.measure", {
                name: step.name,
                value: step.value,
                count: step.tools.length,
                tools: format.list(step.tools),
              }),
          model.data.auditId ? (
            <Button
              key="measure"
              size="sm"
              variant={variant}
              aria-describedby={bodyId}
              onClick={() => {
                model.askAgent(
                  t("agent.prompts.measure", {
                    name: step.name,
                    value: step.value,
                    count: step.tools.length,
                    tools: format.list(step.tools),
                    url: step.pageUrl,
                  }),
                );
              }}
            >
              <WandSparkles />
              {t("agent.draftFix")}
            </Button>
          ) : null,
        ]
      : step.kind === "strategy"
        ? [
            t("agent.steps.strategy", { count: step.count, title: step.title }),
            <Button
              key="strategy"
              size="sm"
              // A link to a list, not a piece of work: it never takes the filled style.
              variant="outline"
              aria-describedby={bodyId}
              onClick={() => {
                void model.setFilters({ tab: "actions" });
              }}
            >
              {t("strategy.actions.open")}
            </Button>,
          ]
        : step.kind === "keyword"
          ? [
              t("agent.steps.keyword", {
                keyword: step.keyword,
                pages: model.data.scope.pageIds.length,
              }),
              model.data.auditId ? (
                <Button
                  key="keyword"
                  size="sm"
                  variant={variant}
                  aria-describedby={bodyId}
                  onClick={() => {
                    model.askAgent(
                      t("agent.prompts.keyword", { keyword: step.keyword }),
                    );
                  }}
                >
                  <WandSparkles />
                  {t("agent.askHow")}
                </Button>
              ) : null,
            ]
          : step.kind === "pages"
            ? [
                // No promise of issues where no check can find them.
                t(
                  canRequestAnalysis
                    ? "agent.steps.pages"
                    : "agent.steps.pagesOff",
                ),
                <Button
                  key="pages"
                  size="sm"
                  variant={variant}
                  onClick={() => model.setDialog("page")}
                >
                  <Plus />
                  {t("addPage")}
                </Button>,
              ]
            : step.kind === "refresh"
              ? [
                  t(`agent.steps.refresh.${step.reason}`),
                  <Button
                    key="refresh"
                    size="sm"
                    variant={variant}
                    loading={refreshing}
                    disabled={model.pending}
                    onClick={refresh}
                  >
                    <RefreshCw />
                    {t("syncNow")}
                  </Button>,
                ]
              : step.kind === "connect"
                ? [
                    t(
                      sync
                        ? `agent.steps.sync.${step.provider}`
                        : `agent.steps.connect.${step.provider}`,
                    ),
                    sync ? (
                      <Button
                        key="sync"
                        size="sm"
                        variant={variant}
                        onClick={() => model.openStatistics(step.provider)}
                      >
                        <RefreshCw />
                        {t("syncStatistics")}
                      </Button>
                    ) : step.provider === "search_console" ? (
                      <SeoGoogleConnection
                        key="connect"
                        variant={variant}
                        onConnected={model.openStatistics}
                        inRow
                      />
                    ) : (
                      <SeoConnectionButton
                        key="connect"
                        provider={step.provider}
                        variant={variant}
                        onConnected={() => model.openStatistics(step.provider)}
                      />
                    ),
                  ]
                : [
                    t(
                      step.available
                        ? "agent.steps.competitors.available"
                        : "agent.steps.competitors.unavailable",
                    ),
                    canEdit && (canRequestAnalysis || !step.available) ? (
                      <Button
                        key="competitors"
                        size="sm"
                        variant={variant}
                        onClick={() =>
                          model.setDialog(
                            step.available ? "analysis" : "competitor",
                          )
                        }
                      >
                        {step.available ? <Search /> : <Plus />}
                        {t(
                          step.available
                            ? "agent.researchCompetitors"
                            : "competitors.add",
                        )}
                      </Button>
                    ) : null,
                  ];
  const Icon = STEP_ICONS[step.kind];
  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        "content-rise flex items-start gap-3 p-4",
      )}
    >
      <span
        aria-hidden
        className="bg-quinary text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <Icon className="size-4" />
      </span>
      {/* A control that wraps starts on the text edge, not under the icon. */}
      {/* A control with a note or an error has its own line: beside the text it would squeeze the text. */}
      <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <p
          id={bodyId}
          className="max-w-prose min-w-0 flex-1 basis-48 text-sm break-words"
        >
          {body}
        </p>
        {control ? (
          <div className="max-w-full min-w-0 has-[p]:basis-full">{control}</div>
        ) : null}
      </div>
    </li>
  );
}

/** An action without the primary button: its title and the way to its card. The Actions tab holds the cards, once. */
function ActionStepRow({
  action,
  severity,
  model,
}: {
  action: Extract<SeoAgentStep, { kind: "action" }>["action"];
  severity: SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  // Every row has the same button name; the title (and the page, where there are several) tells the rows apart.
  const titleId = useId();
  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        "content-rise flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5",
      )}
    >
      <div id={titleId} className="min-w-0 flex-1 basis-48 max-sm:basis-full">
        <p className="text-sm font-medium break-words">{action.title}</p>
        {model.data.scope.pageIds.length > 1 ? (
          <SeoPageLink url={action.pageUrl} />
        ) : null}
      </div>
      {severity ? (
        <SeoSeverity severity={severity}>
          {t(`severity.${severity}`)}
        </SeoSeverity>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        aria-describedby={titleId}
        // On a phone the text has the full width; the mark and the button share the line under it.
        className="max-sm:ml-auto"
        onClick={() => model.showAction(action)}
      >
        {t(action.kind === "fix" ? "overview.seeFix" : "agent.seeSuggestion")}
      </Button>
    </li>
  );
}

/** The SEO agent is the first thing on an Audit: what it knows, what it proposes, and a field to ask it. */
export function SeoAgentHome({ model }: { model: SeoWorkspaceModel }) {
  const [now] = useState(() => new Date());
  const brief = seoAgentBrief(model.data, now);
  // Upkeep lives outside the keyed panel, so a session that finishes loading does not restart it.
  const autopilot = useSeoAutopilot(model, brief);
  // Keyed by viewer and Audit, so a changed account never sees another's unsent question.
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
  const setup = useSeoSetup(model);
  const checkRunning = seoCheckRunning(model.data);
  // A check that ran during this visit: its end is news for a screen reader.
  const [checkSeen, setCheckSeen] = useState(checkRunning);
  if (checkRunning && !checkSeen) setCheckSeen(true);
  // The button that started the check leaves with the setup card. Focus that
  // fell to the page moves to the result; focus anywhere else is left alone.
  const verdict = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (checkSeen && !checkRunning && document.activeElement === document.body)
      verdict.current?.focus();
  }, [checkSeen, checkRunning]);
  // The setup card already offers the connections and the page step.
  const steps = setup
    ? brief.steps.filter(
        (step) => step.kind !== "connect" && step.kind !== "pages",
      )
    : brief.steps;
  const [showAllSteps, setShowAllSteps] = useState(false);
  const shown = showAllSteps ? steps : steps.slice(0, SEO_AGENT_VISIBLE_STEPS);
  // The first proposal with its own button carries the one primary action,
  // unless a setup step or the header's run button holds it.
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const primary =
    setup?.next || seoRunLeads(model.data)
      ? -1
      : steps.findIndex((step) =>
          step.kind === "keyword" || step.kind === "measure"
            ? Boolean(model.data.auditId)
            : step.kind === "competitors"
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
          />
        </li>
      ) : (
        <ActionStepRow
          key={`${step.action.observationId}:${step.action.id}`}
          action={step.action}
          severity={actionSeverity(step.action)}
          model={model}
        />
      )
    ) : (
      <StepRow
        key={`${step.kind}:${"provider" in step ? step.provider : ""}:${"name" in step ? `${step.name}:${step.pageUrl}` : ""}`}
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
      <h2
        id="seo-agent-title"
        className="text-muted-foreground px-2 pt-1 text-xs font-medium"
      >
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
              {" · "}
              {t("agent.lastCheckPages", { pages: brief.lastCheck.pages })}
            </p>
          ) : null}
          <SeoStrategyLine strategy={model.data.strategy} />
          {/* The keyword results as numbers. The issue count is in the headline; its tiles lead the Health tab. */}
          <SeoSummaryTiles
            show="rankings"
            workspace={model.data}
            onOpenRankings={() => {
              void model.setFilters({ tab: "rankings" });
            }}
          />
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
          {checkRunning ? (
            // The status line above announces it; this badge is its picture.
            <span aria-hidden className="block">
              <StatusBadge tone="working" live>
                {t("setup.checkRunningBadge")}
              </StatusBadge>
            </span>
          ) : null}
          {upkeep}
        </div>
      )}
      {/* The setup card has no line for upkeep, so it sits under the card. */}
      {setup && upkeep ? <div className="px-2">{upkeep}</div> : null}
      {!setup && !model.data.observations.length ? (
        <SeoGettingStarted model={model} />
      ) : null}
      {setup && !steps.length ? null : (
        <div className="space-y-2">
          <h3 className="px-2 text-sm font-semibold">
            {t(setup ? "setup.more" : "agent.nextTitle")}
          </h3>
          {steps.length ? (
            <>
              {split ? (
                <ul role="list" className="space-y-2">
                  {shown.slice(0, split).map(stepItem)}
                  {moreActions ? (
                    // The Agent tab shows the first actions only: the rest must not look absent.
                    <li
                      className={cn(
                        HOLDER_ITEM_CLASS,
                        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5",
                      )}
                    >
                      <p className="text-sm">
                        {t("agent.moreActions", {
                          count: moreActions,
                          kind: actionKind,
                        })}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void model.setFilters({ tab: "actions" });
                        }}
                      >
                        {t("agent.allActions", { kind: actionKind })}
                      </Button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {split && split < shown.length ? (
                // The steps after the actions are no issues of the check: the headline does not count them.
                <h4 className="text-muted-foreground px-2 pt-1 text-xs font-medium">
                  {t("agent.otherSteps")}
                </h4>
              ) : null}
              {split < shown.length ? (
                <ul role="list" className="space-y-2">
                  {shown
                    .slice(split)
                    .map((step, index) => stepItem(step, index + split))}
                </ul>
              ) : null}
            </>
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
              <ChevronDown
                className={cn(
                  "transition-transform duration-150 ease-out motion-reduce:transition-none",
                  showAllSteps && "rotate-180",
                )}
              />
              {showAllSteps
                ? t("overview.showLess")
                : t("agent.moreSteps", {
                    count: steps.length - SEO_AGENT_VISIBLE_STEPS,
                  })}
            </Button>
          ) : null}
        </div>
      )}
      {/* The next steps come first; a question to the agent follows them. The chat itself opens in the sheet, on every tab. */}
      {model.data.auditId ? <SeoAskBar model={model} /> : null}
      {/* During setup a schedule is not the next step: show only one that exists. */}
      {setup && !model.data.monitors.length ? null : (
        <SeoAutomation model={model} />
      )}
    </section>
  );
}
