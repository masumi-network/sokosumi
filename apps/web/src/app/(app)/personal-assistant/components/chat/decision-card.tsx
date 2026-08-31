"use client";

import { Check, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  formatRedactedValue,
  summarizeProposal,
} from "@/components/soko-bot/proposal-summary";
import { Button } from "@/components/ui/button";
import { resolveSokoBotDecisionAction } from "@/lib/actions/soko-bot/action";
import type { ChatDecision } from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

import { useToolLabel } from "./turn-progress";

type Resolution = "ACCEPT" | "REJECT";

/**
 * Inline approval: what the bot wants to do, why, and Accept / Reject. Sits
 * in the assistant row so the decision is where the conversation is, not in
 * a side panel. Resolved decisions stay as a read-only trail.
 */
export function DecisionCard({
  decision,
  onResolved,
}: {
  decision: ChatDecision;
  onResolved: () => void;
}) {
  const t = useTranslations("App.SokoBot.Chat.decision");
  const tProposal = useTranslations("Components.SokoBot.Proposal");
  const tExplain = useTranslations("Components.SokoBot.DecisionExplain");
  const format = useFormatter();
  const toolLabel = useToolLabel();
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState<Resolution | null>(null);

  const summary = summarizeProposal(decision.toolName, decision.proposal);
  const pending = decision.status === "PENDING";
  const acceptDisabled = !summary.acceptable;

  function resolve(resolution: Resolution) {
    setInFlight(resolution);
    startTransition(async () => {
      const result = await resolveSokoBotDecisionAction({
        decisionId: decision.id,
        resolution,
      });
      setInFlight(null);
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(resolution === "ACCEPT" ? t("accepted") : t("rejected"));
      onResolved();
    });
  }

  return (
    <div
      className={cn(
        "bg-card w-full max-w-xl rounded-lg border",
        pending ? "border-primary/40" : "border-border/60",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <p className="text-sm font-medium">
          {pending ? t("heading") : t("headingResolved")}
        </p>
        <span className="text-muted-foreground text-xs">
          {toolLabel(decision.toolName)}
        </span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-foreground text-sm leading-relaxed">
          {decision.reason}
        </p>
        {summary.fields.length > 0 ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {summary.fields.map((field) => (
              <div key={field.key} className="contents">
                <dt className="text-muted-foreground">
                  {tProposal(`fields.${field.key}`)}
                </dt>
                <dd
                  className={cn(
                    "text-foreground min-w-0 break-words",
                    field.mono && "font-mono",
                  )}
                >
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {summary.raw !== null ? (
          <p className="text-muted-foreground break-words font-mono text-xs">
            {formatRedactedValue(summary.raw)}
          </p>
        ) : null}
        {!summary.acceptable ? (
          <p role="status" className="text-semantic-warning text-xs">
            {tProposal("incomplete")}
          </p>
        ) : null}
        {pending ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={isPending || acceptDisabled}
              onClick={() => resolve("ACCEPT")}
            >
              <Check aria-hidden className="size-3.5" />
              {inFlight === "ACCEPT" ? t("accepting") : t("accept")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => resolve("REJECT")}
            >
              <X aria-hidden className="size-3.5" />
              {inFlight === "REJECT" ? t("rejecting") : t("reject")}
            </Button>
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">
              {t("expires", {
                time: format.dateTime(new Date(decision.expiresAt), {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              })}
            </span>
          </div>
        ) : (
          <p
            className={cn(
              "text-xs",
              decision.status === "ACCEPTED" && "text-semantic-success",
              decision.status === "PROCESSING" && "text-semantic-warning",
              (decision.status === "REJECTED" ||
                decision.status === "EXPIRED") &&
                "text-muted-foreground",
            )}
          >
            {tExplain(decision.status)}
          </p>
        )}
      </div>
    </div>
  );
}
