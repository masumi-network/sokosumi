"use client";

import { Check, ChevronRight, Loader2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { OrbState } from "thinking-orbs";

import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

import { RotatingMessages } from "./rotating-messages";
import { ThinkingOrb } from "./thinking-orb";
import type { ProgressChip } from "./timeline";

/** Human label for a capability the runtime called. */
export function useToolLabel() {
  const t = useTranslations("App.SokoBot.Chat.tools");
  return (toolName: string | null): string => {
    if (!toolName) return t("default");
    return t.has(toolName) ? t(toolName) : toolName.replaceAll("_", " ");
  };
}

/** Live `Ns` counter since the turn started. */
export function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label =
    secs < 60
      ? `${secs}s`
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <span className="text-muted-foreground/70 ml-1.5 text-xs tabular-nums">
      {label}
    </span>
  );
}

/**
 * The assistant row while a turn runs: thinking orb in the avatar gutter,
 * a rotating phrase (or the live tool chips once the runtime starts acting),
 * and an elapsed timer so a long turn never reads as stuck.
 */
export function TurnProgress({
  chips,
  startedAt,
  orbState,
  cancelRequested,
}: {
  chips: ProgressChip[];
  startedAt: number | null;
  orbState: OrbState;
  cancelRequested: boolean;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const toolLabel = useToolLabel();
  const thinkingMessages = orderedMessageList(
    t.raw("thinkingMessages") as Record<string, string>,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const secs = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const escalation = cancelRequested
    ? t("cancelling")
    : secs >= 45
      ? t("stillWorkingLong")
      : secs >= 15
        ? t("stillWorking")
        : null;

  return (
    <div className="flex min-h-11 w-full items-start gap-3 px-4 py-1.5">
      <ThinkingOrb size={32} state={cancelRequested ? "solving" : orbState} />
      <div className="flex min-w-0 flex-col gap-1.5 pt-1">
        {chips.length === 0 ? (
          <div className="flex min-h-5 items-center gap-1.5 pt-1">
            {escalation ? (
              <span className="reasoning-text-shine text-foreground text-sm leading-5">
                {escalation}
              </span>
            ) : (
              <RotatingMessages
                messages={thinkingMessages}
                intervalMs={2_800}
                className="reasoning-text-shine text-foreground text-sm leading-5"
              />
            )}
            {startedAt ? <ElapsedTimer startedAt={startedAt} /> : null}
          </div>
        ) : (
          chips.map((chip, i) => {
            const isLast = i === chips.length - 1;
            return (
              <div
                key={chip.id}
                className="flex min-w-0 items-center gap-2 text-sm"
              >
                {chip.done ? (
                  <Check
                    aria-hidden
                    className="text-primary/70 size-3.5 shrink-0"
                  />
                ) : (
                  <Loader2
                    aria-hidden
                    className="text-primary size-3.5 shrink-0 animate-spin"
                  />
                )}
                <span
                  className={cn(
                    "shrink-0 font-medium",
                    chip.done ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {toolLabel(chip.toolName)}
                </span>
                {isLast && startedAt ? (
                  <ElapsedTimer startedAt={startedAt} />
                ) : null}
              </div>
            );
          })
        )}
        {chips.length > 0 && escalation ? (
          <span className="reasoning-text-shine text-muted-foreground text-xs">
            {escalation}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Collapsible list of the tool steps a finished turn went through. */
export function CompletedSteps({ steps }: { steps: ProgressChip[] }) {
  const t = useTranslations("App.SokoBot.Chat");
  const toolLabel = useToolLabel();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="pr-10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded text-xs font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <Wrench aria-hidden className="size-3" />
        {t("toolSteps", { count: steps.length })}
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? (
        <div className="border-border/60 mt-1.5 flex flex-col gap-1.5 border-l pl-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className="text-muted-foreground flex items-start gap-1.5 text-xs"
            >
              <Check
                aria-hidden
                className="text-primary/60 mt-0.5 size-3 shrink-0"
              />
              <span className="text-foreground/80 font-medium">
                {toolLabel(step.toolName)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
