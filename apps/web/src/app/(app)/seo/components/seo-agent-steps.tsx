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
  Settings2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  SeoActionCard,
  SeoActionFinding,
  SeoActionTaskButton,
} from "./seo-actions";
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
  first,
  banner,
  flush = false,
}: {
  /** The step stands alone as a banner with this title, not as a row of the step list. */
  banner?: string;
  step: SeoButtonStep;
  model: SeoWorkspaceModel;
  /** The agent's top proposal carries the one primary button. */
  first: boolean;
  /** The row sits inside another card: no surface of its own. */
  flush?: boolean;
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
          // A failed sync has its alert and Retry in the verdict card, which drops this step.
          null,
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
                <Settings2 />
                {t("manageStatistics")}
              </Button>
            ) : step.provider === "search_console" ? (
              <SeoGoogleConnection
                key="connect"
                variant={variant}
                onError={setConnectError}
                inRow
              />
            ) : (
              <SeoConnectionButton
                key="connect"
                provider={step.provider}
                variant={variant}
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
        !flush && HOLDER_ITEM_CLASS,
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
 * A row that counts the actions of the keyword strategy: it leads to their group on the Actions tab, with every
 * row in view. The whole row is the button, with the arrow at its end. A sentence with a button of its own was
 * the heaviest row of the list for its last step.
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
        onClick={model.showStrategy}
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronRight className="size-4 shrink-0" />
      </button>
    </li>
  );
}

/**
 * An action as one row: its title, and a press opens its card in a dialog on the same tab. The lead row also
 * says what the check found and has the action's button under it, outside the row's own button.
 */
export function SeoActionStepRow({
  action,
  severity,
  model,
  onOpen,
  lead = false,
}: {
  action: Extract<SeoAgentStep, { kind: "action" }>["action"];
  severity: SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
  /** Opens the action's card in the tab's one action dialog; the row is the place focus returns to. */
  onOpen: (row: HTMLButtonElement) => void;
  /** The first step of the verdict card: no frame of its own, the finding and the button. */
  lead?: boolean;
}) {
  const findingId = useId();
  return (
    <li className="content-rise">
      <button
        type="button"
        // The finding describes the row: as part of its name it read several sentences per press.
        aria-describedby={lead ? findingId : undefined}
        className={cn(
          SEO_ROW_BUTTON_CLASS,
          "px-4 py-2.5",
          lead && "rounded-none border-0 bg-transparent",
        )}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span className="min-w-0 flex-1">
          {/* On a phone the impact label stands under the title: beside it, the title broke into five lines. */}
          <span className="gap-3 sm:flex sm:items-center">
            <SeoActionName
              title={action.title}
              pageUrl={action.pageUrl}
              workspace={model.data}
              strong={lead}
            />
            {severity ? (
              <span className="flex max-sm:mt-1">
                <SeoSeverity severity={severity} />
              </span>
            ) : null}
          </span>
          {lead ? (
            <span
              id={findingId}
              aria-hidden
              className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
            >
              <SeoActionFinding action={action} model={model} />
            </span>
          ) : null}
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      </button>
      {lead ? (
        <div className="px-4 pb-3">
          <SeoActionTaskButton action={action} model={model} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The card of an action row, in a dialog on the Agent tab. The dialog belongs to the tab, not to the row: a
 * Task for the action takes its row out of the steps, and the dialog stays to show the Task.
 */
export function SeoActionDialog({
  action,
  severity,
  model,
  onClose,
  onCloseAutoFocus,
}: {
  action: Extract<SeoAgentStep, { kind: "action" }>["action"] | undefined;
  severity: SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {action ? (
        // The card names the action in its own heading; the dialog title repeats it for the dialog's name. The
        // top padding keeps the close button clear of the title. A long card scrolls inside the screen, under the
        // close button, which stays in view.
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 pt-10 sm:max-w-xl"
          onCloseAutoFocus={onCloseAutoFocus}
          // The card is the whole content: no separate description.
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{action.title}</DialogTitle>
          <div className="min-h-0 overflow-y-auto">
            <SeoActionCard
              action={action}
              model={model}
              severity={severity}
              primary
              fixed
              flush
              full
            />
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
