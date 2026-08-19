import { getFormatter, getTranslations } from "next-intl/server";

import Markdown from "@/components/markdown";
import { formatDurationMs } from "@/components/soko-bot/format";
import { isHireProposalAcceptable } from "@/components/soko-bot/proposal-summary";
import {
  TurnRouteBadge,
  TurnStatusBadge,
} from "@/components/soko-bot/soko-bot-badges";
import { TurnActivity } from "@/components/soko-bot/turn-activity";
import type { SokoBotTurn } from "@/lib/clients/generated/core";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { ACTIVE_SOKO_BOT_TURN_STATUSES } from "@/lib/soko-bot/constants";

import { CancelTurnButton } from "./cancel-turn-button.client";
import { DecisionActions } from "./decision-actions.client";
import { TurnPoller } from "./turn-poller.client";

function isActiveTurn(turn: SokoBotTurn): boolean {
  return ACTIVE_SOKO_BOT_TURN_STATUSES.has(turn.status);
}

/**
 * Recent turns, oldest first so the newest sits above the composer. Each turn
 * carries its Core-projected activity in a native disclosure — no client
 * state, keyboard/screen-reader accessible by default.
 */
export async function TurnList() {
  const [turns, t, format] = await Promise.all([
    sokoBotService.listTurns(),
    getTranslations("App.SokoBot.Turns"),
    getFormatter(),
  ]);
  const ordered = [...turns].reverse();
  const activeTurnIds = turns.filter(isActiveTurn).map((turn) => turn.id);

  return (
    <div className="space-y-3">
      <TurnPoller activeTurnIds={activeTurnIds} />
      <h2 className="sr-only">{t("conversationHeading")}</h2>
      {ordered.length === 0 ? (
        <div className="bg-background rounded-md border px-4 py-10 text-center">
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("emptyDescription")}
          </p>
        </div>
      ) : null}
      <ol className="space-y-3">
        {ordered.map((turn) => {
          const active = isActiveTurn(turn);
          const pendingCount = (turn.pendingDecisions ?? []).filter(
            (decision) => decision.status === "PENDING",
          ).length;
          return (
            <li
              key={turn.id}
              className="bg-background rounded-md border"
              aria-busy={active}
            >
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                <time
                  dateTime={turn.createdAt.toISOString()}
                  className="text-muted-foreground text-xs tabular-nums"
                >
                  {format.dateTime(turn.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
                <TurnStatusBadge status={turn.status} />
                <TurnRouteBadge route={turn.route} />
                {turn.source !== "CHAT" ? (
                  <span className="text-muted-foreground text-xs">
                    {t(`source.${turn.source}`)}
                  </span>
                ) : null}
                {turn.durationMs !== null ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDurationMs(turn.durationMs)}
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  {pendingCount > 0 ? (
                    <span className="text-semantic-warning text-xs font-medium">
                      {t("pendingDecisions", { count: pendingCount })}
                    </span>
                  ) : null}
                  {active && turn.status !== "CANCEL_REQUESTED" ? (
                    <CancelTurnButton turnId={turn.id} />
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 px-4 py-3">
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">{t("you")}</p>
                  <p className="whitespace-pre-wrap text-sm">
                    {turn.userMessage}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">
                    {t("assistant")}
                  </p>
                  {turn.finalAnswer ? (
                    <Markdown className="prose prose-sm dark:prose-invert max-w-none">
                      {turn.finalAnswer}
                    </Markdown>
                  ) : turn.status === "FAILED" ? (
                    <p className="text-semantic-destructive text-sm">
                      {turn.errorDetail ?? turn.errorKind ?? t("failed")}
                    </p>
                  ) : turn.status === "CANCELLED" ? (
                    <p className="text-muted-foreground text-sm">
                      {t("cancelled")}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t("working")}
                    </p>
                  )}
                </div>

                <details className="group rounded border">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none px-3 py-1.5 text-xs font-medium">
                    {t("activity", {
                      count:
                        (turn.events?.length ?? 0) +
                        (turn.delegations?.length ?? 0) +
                        (turn.pendingDecisions?.length ?? 0),
                    })}
                  </summary>
                  <div className="border-t px-3 py-3">
                    <TurnActivity
                      events={turn.events}
                      delegations={turn.delegations}
                      decisions={turn.pendingDecisions}
                      renderDecisionActions={(decision) => (
                        <DecisionActions
                          decisionId={decision.id}
                          acceptDisabled={
                            decision.toolName === "hire_agent" &&
                            !isHireProposalAcceptable(decision.proposal)
                          }
                        />
                      )}
                    />
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
