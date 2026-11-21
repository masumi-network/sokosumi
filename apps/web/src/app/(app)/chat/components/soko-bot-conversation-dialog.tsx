"use client";

import type { SokoBotConversation } from "@sokosumi/core-client";
import { Route } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResultDto } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { getSokoBotTurnConversationAction } from "@/lib/actions/soko-bot/action";

type Step = SokoBotConversation["steps"][number];

function usd(value: number | null): string | null {
  if (value === null) return null;
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function seconds(ms: number | null): string | null {
  return ms === null ? null : `${Math.max(1, Math.round(ms / 1000))} s`;
}

/** One line under a step: model · cost · time, whatever is known. */
function StepMeta({ step }: { step: Step }) {
  if (step.kind === "asked") return null;
  const parts = [
    step.model,
    usd(step.costUsd),
    seconds(step.durationMs),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="text-muted-foreground font-mono text-xs tabular-nums">
      {parts.join(" · ")}
    </p>
  );
}

/** "How I got this": who the bot asked, what came back, and what each step cost. */
export function SokoBotConversationButton({
  turnId,
  buttonClassName,
  load = getSokoBotTurnConversationAction,
}: {
  turnId: string;
  buttonClassName: string;
  /** The owner's own turns by default; the admin view passes its own reader. */
  load?: (input: {
    turnId: string;
  }) => Promise<ActionResultDto<SokoBotConversation, ActionError>>;
}) {
  const t = useTranslations("App.Chat.SokoBot.Conversation");
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<SokoBotConversation | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function show() {
    setOpen(true);
    if (conversation) return;
    startTransition(async () => {
      const result = await load({ turnId }).catch(() => null);
      if (result?.ok) setConversation(result.value);
      else setFailed(true);
    });
  }

  function label(step: Step): string {
    if (step.kind === "turn") return step.title;
    if (step.kind === "asked") return t("asked", { by: step.by, to: step.to });
    return t("answered", { by: step.by });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("open")}
        aria-label={t("open")}
        onClick={show}
      >
        <Route aria-hidden className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {conversation
                ? t("totals", {
                    cost: usd(conversation.totals.costUsd) ?? "$0",
                    time: seconds(conversation.totals.durationMs) ?? "0 s",
                    models: conversation.totals.models.join(", ") || "–",
                  })
                : pending
                  ? t("loading")
                  : failed
                    ? t("error")
                    : null}
            </DialogDescription>
          </DialogHeader>
          {conversation ? (
            <ol className="space-y-4">
              {conversation.steps.map((step) => (
                <li
                  key={`${step.kind}-${step.at}`}
                  className="border-border space-y-1 border-l-2 pl-3"
                >
                  <p className="text-sm font-medium">{label(step)}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(step.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    {step.kind === "turn" ? "" : ` · #${step.room}`}
                  </p>
                  {step.kind === "turn" ? null : (
                    <p className="text-sm whitespace-pre-wrap">{step.text}</p>
                  )}
                  <StepMeta step={step} />
                  {step.kind === "turn" && step.modelReason ? (
                    <p className="text-muted-foreground text-xs">
                      {step.modelReason}
                    </p>
                  ) : null}
                  {step.kind === "turn" && step.calls.length > 0 ? (
                    <ul className="text-muted-foreground font-mono text-xs tabular-nums">
                      {step.calls.map((group) => (
                        <li key={`${group.role}-${group.model}`}>
                          {group.role} · {group.model} ×{group.calls} ·{" "}
                          {usd(group.costUsd)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
