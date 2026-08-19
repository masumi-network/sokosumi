import { getFormatter, getTranslations } from "next-intl/server";
import { DecisionProposal } from "@/components/soko-bot/decision-proposal";
import { DecisionStatusNote } from "@/components/soko-bot/decision-status-note";
import { Panel } from "@/components/soko-bot/panel";
import { isHireProposalAcceptable } from "@/components/soko-bot/proposal-summary";
import { DecisionStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import type { SokoBotPendingDecision } from "@/lib/clients/generated/core";

import { DecisionActions } from "./decision-actions.client";

interface PendingDecisionsPanelProps {
  decisions: SokoBotPendingDecision[];
}

/** Bot-level pending approvals; each resolves through Core. */
export async function PendingDecisionsPanel({
  decisions,
}: PendingDecisionsPanelProps) {
  // PROCESSING (seller-side start in flight / unconfirmed) stays visible with
  // an explanation instead of silently disappearing from the list.
  const pending = decisions.filter(
    (decision) =>
      decision.status === "PENDING" || decision.status === "PROCESSING",
  );
  if (pending.length === 0) return null;

  const [t, format] = await Promise.all([
    getTranslations("App.SokoBot.Decisions"),
    getFormatter(),
  ]);

  return (
    <Panel
      id="soko-bot-decisions"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-semantic-warning text-xs font-medium tabular-nums">
          {pending.length}
        </span>
      }
      flush
    >
      <ul className="divide-y">
        {pending.map((decision) => (
          <li key={decision.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs">{decision.toolName}</span>
                {decision.status !== "PENDING" ? (
                  <DecisionStatusBadge status={decision.status} />
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">
                {t("expires")}{" "}
                {format.dateTime(decision.expiresAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground text-xs">
                {t("botReason")}{" "}
              </span>
              {decision.reason}
            </p>
            <DecisionProposal
              toolName={decision.toolName}
              proposal={decision.proposal}
              className="rounded border px-3 py-2"
            />
            <DecisionStatusNote
              status={decision.status}
              resultingEntityId={decision.resultingEntityId}
            />
            {decision.status === "PENDING" ? (
              <DecisionActions
                decisionId={decision.id}
                acceptDisabled={
                  decision.toolName === "hire_agent" &&
                  !isHireProposalAcceptable(decision.proposal)
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
