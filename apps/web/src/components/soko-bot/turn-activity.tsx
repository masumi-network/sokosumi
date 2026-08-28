import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import type {
  SokoBotDelegation,
  SokoBotEvent,
  SokoBotPendingDecision,
  SokoBotToolCall,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { DecisionProposal } from "./decision-proposal";
import { DecisionStatusNote } from "./decision-status-note";
import { formatDurationMs } from "./format";
import {
  DecisionStatusBadge,
  DelegationKindBadge,
  ToolCallStatusBadge,
} from "./soko-bot-badges";

interface TurnActivityProps {
  events?: SokoBotEvent[];
  delegations?: SokoBotDelegation[];
  decisions?: SokoBotPendingDecision[];
  /** Admin-only capability calls; omitted on the user surface. */
  toolCalls?: SokoBotToolCall[];
  /** Renders accept/reject controls for a pending decision (user surface). */
  renderDecisionActions?: (decision: SokoBotPendingDecision) => ReactNode;
  className?: string;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
      {children}
    </h3>
  );
}

/**
 * Event timeline, tool calls, delegations, and decisions for one turn.
 * Only Core-projected safe summaries are shown — never model reasoning.
 */
export async function TurnActivity({
  events = [],
  delegations = [],
  decisions = [],
  toolCalls,
  renderDecisionActions,
  className,
}: TurnActivityProps) {
  const [t, format] = await Promise.all([
    getTranslations("Components.SokoBot.Activity"),
    getFormatter(),
  ]);
  const time = (date: Date) =>
    format.dateTime(date, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const isEmpty =
    events.length === 0 &&
    delegations.length === 0 &&
    decisions.length === 0 &&
    (toolCalls?.length ?? 0) === 0;

  if (isEmpty) {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>
        {t("empty")}
      </p>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {events.length > 0 ? (
        <div className="space-y-2">
          <SectionLabel>{t("events", { count: events.length })}</SectionLabel>
          <ol className="divide-y rounded border">
            {events.map((event) => (
              <li
                key={event.id}
                className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 px-3 py-1.5 text-sm"
              >
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {time(event.createdAt)}
                </span>
                <span className="min-w-0">
                  <span className="font-mono text-xs">{event.type}</span>
                  {event.toolName ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {" · "}
                      {event.toolName}
                      {event.toolStatus ? ` (${event.toolStatus})` : ""}
                    </span>
                  ) : null}
                  {event.summary ? (
                    <span className="text-muted-foreground block truncate text-xs">
                      {event.summary}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {formatDurationMs(event.durationMs) ?? ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {toolCalls && toolCalls.length > 0 ? (
        <div className="space-y-2">
          <SectionLabel>
            {t("toolCalls", { count: toolCalls.length })}
          </SectionLabel>
          <ul className="divide-y rounded border">
            {toolCalls.map((call) => (
              <li
                key={call.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
              >
                <span className="font-mono text-xs">{call.capability}</span>
                <ToolCallStatusBadge status={call.status} />
                <span className="text-muted-foreground font-mono text-xs">
                  {call.toolCallId}
                </span>
                {call.errorKind ? (
                  <span className="text-semantic-destructive text-xs">
                    {call.errorKind}
                    {call.errorDetail ? `: ${call.errorDetail}` : ""}
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
                  {time(call.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {delegations.length > 0 ? (
        <div className="space-y-2">
          <SectionLabel>
            {t("delegations", { count: delegations.length })}
          </SectionLabel>
          <ul className="divide-y rounded border">
            {delegations.map((delegation) => (
              <li
                key={delegation.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
              >
                <DelegationKindBadge kind={delegation.kind} />
                <span className="font-medium">{delegation.action}</span>
                {delegation.taskId ? (
                  <Link
                    href={`/tasks/${encodeURIComponent(delegation.taskId)}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t("openTask")}
                  </Link>
                ) : null}
                {delegation.jobId ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    {t("job")} {delegation.jobId}
                  </span>
                ) : null}
                {delegation.outcome ? (
                  <span
                    className={cn(
                      "text-xs",
                      delegation.outcome === "failed" &&
                        "text-semantic-destructive",
                      delegation.outcome === "ambiguous" &&
                        "text-semantic-warning",
                      delegation.outcome === "processing" &&
                        "text-semantic-info",
                      !["failed", "ambiguous", "processing"].includes(
                        delegation.outcome,
                      ) && "text-muted-foreground",
                    )}
                  >
                    {t.has(`outcome.${delegation.outcome}`)
                      ? t(`outcome.${delegation.outcome}`)
                      : delegation.outcome}
                  </span>
                ) : null}
                {delegation.error ? (
                  <span className="text-semantic-destructive text-xs">
                    {delegation.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {decisions.length > 0 ? (
        <div className="space-y-2">
          <SectionLabel>
            {t("decisions", { count: decisions.length })}
          </SectionLabel>
          <ul className="divide-y rounded border">
            {decisions.map((decision) => (
              <li key={decision.id} className="space-y-2 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs">{decision.toolName}</span>
                  <DecisionStatusBadge status={decision.status} />
                  <span className="text-muted-foreground text-xs">
                    {t("expires")}{" "}
                    {format.dateTime(decision.expiresAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="text-foreground">{decision.reason}</p>
                <DecisionProposal
                  toolName={decision.toolName}
                  proposal={decision.proposal}
                />
                <DecisionStatusNote
                  status={decision.status}
                  resultingEntityId={decision.resultingEntityId}
                />
                {decision.status === "PENDING" && renderDecisionActions
                  ? renderDecisionActions(decision)
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
