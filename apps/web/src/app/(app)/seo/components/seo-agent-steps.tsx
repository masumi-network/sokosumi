"use client";

import {
  ChartColumn,
  ChevronRight,
  type LucideIcon,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import type { SeoAgentStep } from "./seo-agent-model";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGoogleConnection } from "./seo-google-connection";
import type { SeoIssueSeverity } from "./seo-overview-model";
import { SEO_ROW_BUTTON_CLASS, SeoActionName, SeoSeverity } from "./seo-shared";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** A step with a sentence and its own button. An action and the strategy actions are rows that lead to a card. */
type SeoButtonStep = Exclude<SeoAgentStep, { kind: "action" | "strategy" }>;

const STEP_ICONS: Record<SeoButtonStep["kind"], LucideIcon> = {
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
  step: SeoButtonStep;
  model: SeoWorkspaceModel;
  refresh: () => void;
  refreshing: boolean;
  /** The agent's top proposal carries the one primary button. */
  first: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const variant = first ? "primary" : "outline";
  // A connection that failed says so in the place of the step's text: nothing in the row moves.
  const [connectError, setConnectError] = useState<string | null>(null);
  // A connected account with nothing synced: the step asks for the sync, not for the account.
  // The account's own actions are in the sync dialog.
  const connectStep = step.kind === "connect";
  const sync =
    useSeoConnectionStatus(
      connectStep ? step.provider : "search_console",
      connectStep,
    ).status.data?.status === "connected" && connectStep;
  const [body, control] =
    step.kind === "refresh"
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
                onError={setConnectError}
                inRow
              />
            ) : (
              <SeoConnectionButton
                key="connect"
                provider={step.provider}
                variant={variant}
                onConnected={() => model.openStatistics(step.provider)}
                onError={setConnectError}
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
                  model.setDialog(step.available ? "analysis" : "competitor")
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
        // The one coloured surface of the tab: statistics are missing, and one button sets them up.
        banner && "bg-chart-3-quinary",
      )}
      data-testid={banner ? "seo-statistics-banner" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          banner
            ? // On a phone the title and the button need the width of the mark to share one row.
              "bg-semantic-warning text-semantic-warning-foreground max-sm:hidden"
            : "bg-quinary text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      {/* A control that wraps starts on the text edge, not under the icon. */}
      {/* A control with a note or an error has its own line: beside the text it would squeeze the text. */}
      <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <div
          className={cn(
            "max-w-prose min-w-0 flex-1 basis-48 space-y-0.5",
            banner && "max-sm:basis-24",
          )}
        >
          {banner ? <h3 className="text-sm font-semibold">{banner}</h3> : null}
          {/* The text and the error share one cell, so the row keeps the height of the taller one. */}
          <div className="grid">
            <p
              className={cn(
                "col-start-1 row-start-1 text-sm break-words",
                // On a phone the banner is its title and its button: the sentence stands on the Traffic tab.
                banner && "text-muted-foreground max-sm:hidden",
                connectError && "invisible",
              )}
            >
              {body}
            </p>
            {connectError ? (
              <p
                role="alert"
                className="text-destructive col-start-1 row-start-1 text-sm break-words"
              >
                {connectError}
              </p>
            ) : null}
          </div>
        </div>
        {control ? (
          <div className="max-w-full min-w-0 has-[p]:basis-full">{control}</div>
        ) : null}
      </div>
    </Shell>
  );
}

/**
 * A row that leads to the Actions tab: the rest of the fixes, or the actions of the keyword strategy.
 * The whole row is the button, with the arrow at its end. A sentence with a button of its own was the heaviest
 * row of the list for its last step.
 */
export function SeoActionsLinkRow({
  model,
  children,
}: {
  model: SeoWorkspaceModel;
  children: ReactNode;
}) {
  return (
    <li className="content-rise">
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
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronRight className="size-4 shrink-0" />
      </button>
    </li>
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
  return (
    <li className="content-rise">
      <button
        type="button"
        className={cn(SEO_ROW_BUTTON_CLASS, "px-4 py-2.5")}
        onClick={() => model.showAction(action)}
      >
        {/* On a phone the impact label stands under the title: beside it, the title broke into five lines. */}
        <span className="min-w-0 flex-1 gap-3 sm:flex sm:items-center">
          <SeoActionName
            title={action.title}
            pageUrl={action.pageUrl}
            workspace={model.data}
          />
          {severity ? (
            <span className="flex max-sm:mt-1">
              <SeoSeverity severity={severity} />
            </span>
          ) : null}
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      </button>
    </li>
  );
}
