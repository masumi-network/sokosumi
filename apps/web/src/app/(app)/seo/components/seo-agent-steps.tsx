"use client";

import {
  ChartColumn,
  Compass,
  FileText,
  Lightbulb,
  type LucideIcon,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Search,
  WandSparkles,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import type { SeoAgentStep } from "./seo-agent-model";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGoogleConnection } from "./seo-google-connection";
import type { SeoIssueSeverity } from "./seo-overview-model";
import {
  SeoPageLink,
  SeoSeverity,
  seoPageName,
  seoSiteUrl,
} from "./seo-shared";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const STEP_ICONS: Record<
  Exclude<SeoAgentStep, { kind: "action" }>["kind"],
  LucideIcon
> = {
  measure: Lightbulb,
  strategy: Compass,
  keyword: Search,
  positions: Search,
  pages: FileText,
  refresh: RefreshCw,
  connect: Plug,
  // Not the people icon: the chat uses that one for "shared in your organization".
  competitors: Radar,
};

export function SeoStepRow({
  step,
  model,
  refresh,
  refreshing,
  first,
  banner,
}: {
  /** The step stands alone as a banner with this title, not as a row of the step list. */
  banner?: string;
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
                // The request to the agent below keeps the full address.
                url: seoPageName(
                  step.pageUrl,
                  seoSiteUrl(model.data),
                  t("pages.homeInText"),
                ),
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
        : step.kind === "keyword" || step.kind === "positions"
          ? [
              step.kind === "keyword"
                ? t("agent.steps.keyword", {
                    keyword: step.keyword,
                    pages: model.data.scope.pageIds.length,
                  })
                : // "The most searches" needs a second keyword and a known number.
                  t(
                    step.keywords > 1 && step.volume !== null
                      ? "agent.steps.positionsSearched"
                      : "agent.steps.positions",
                    {
                      keyword: step.keyword,
                      volume: step.volume ?? 0,
                      pages: model.data.scope.pageIds.length,
                    },
                  ),
              model.data.auditId ? (
                <Button
                  key="keyword"
                  size="sm"
                  variant={variant}
                  aria-describedby={bodyId}
                  onClick={() => {
                    model.askAgent(
                      t(`agent.prompts.${step.kind}`, {
                        keyword: step.keyword,
                      }),
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
  const Icon = banner ? ChartColumn : STEP_ICONS[step.kind];
  const Shell = banner ? "div" : "li";
  return (
    <Shell
      className={cn(
        HOLDER_ITEM_CLASS,
        "content-rise flex items-start gap-3 p-4",
      )}
      data-testid={banner ? "seo-statistics-banner" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          banner
            ? "bg-chart-5/15 text-chart-5"
            : "bg-quinary text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      {/* A control that wraps starts on the text edge, not under the icon. */}
      {/* A control with a note or an error has its own line: beside the text it would squeeze the text. */}
      <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="max-w-prose min-w-0 flex-1 basis-48 space-y-0.5">
          {banner ? <h3 className="text-sm font-semibold">{banner}</h3> : null}
          <p
            id={bodyId}
            className={cn(
              "text-sm break-words",
              banner && "text-muted-foreground",
            )}
          >
            {body}
          </p>
        </div>
        {control ? (
          <div className="max-w-full min-w-0 has-[p]:basis-full">{control}</div>
        ) : null}
      </div>
    </Shell>
  );
}

/** An action without the primary button: its title and the way to its card. The Actions tab holds the cards, once. */
export function SeoActionStepRow({
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
          <SeoPageLink url={action.pageUrl} site={seoSiteUrl(model.data)} />
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
