"use client";

import { Check, ChevronRight, Copy, Wrench } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { AssistantAvatar } from "./assistant-context";
import { parseConfirmationResolved, TaskResultCard } from "./task-result-card";
import type { Message, ProgressStep } from "./types";

/**
 * Pull suggested prompts out of a welcome-style message. The orchestrator
 * formats them as markdown list items of the form:
 *   - **Label** — "Quoted prompt to send to Hermes."
 * We extract the quoted text and render it as click-to-send chips below
 * the message. Best-effort: returns [] if no quoted strings are found.
 */
export function extractSuggestedPrompts(content: string): string[] {
  const prompts: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("-") && !line.startsWith("*")) continue;
    // Match the FIRST `"..."` on the line. Use a non-greedy match to handle
    // multiple quoted segments on one line gracefully (we only chip the first).
    const match = line.match(/["“]([^"“”]{8,200})["”]/);
    if (match?.[1]) prompts.push(match[1].trim());
  }
  // De-dup while preserving order, cap at 6 to keep the strip readable.
  return Array.from(new Set(prompts)).slice(0, 6);
}

export function MessageRow({
  message,
  userImageUrl,
  userName,
  isStreaming = false,
  durationMs,
  steps,
  onSelectSuggestion,
}: {
  message: Message;
  userImageUrl?: string | null;
  userName?: string | null;
  isStreaming?: boolean;
  durationMs?: number;
  steps?: ProgressStep[];
  onSelectSuggestion?: (prompt: string) => void;
}) {
  const t = useTranslations("App.Hermes.Running");
  const formatter = useFormatter();
  const isUser = message.role === "user";
  const createdAt = new Date(message.createdAt);
  // Same-day messages show just the time; older ones carry the date so
  // scrollback stays legible ("Jul 16, 14:32" instead of a bare "14:32").
  const isSameDay = createdAt.toDateString() === new Date().toDateString();
  const timestamp = formatter.dateTime(
    createdAt,
    isSameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  );

  if (isUser) {
    return (
      <div className="group/message flex w-full justify-end gap-3 px-4 py-0.5">
        <div className="flex max-w-[70%] flex-col items-end gap-0.5">
          <div className="bg-muted-foreground/10 text-foreground min-h-6 rounded-lg px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
            {message.content}
          </div>
          <time
            dateTime={message.createdAt}
            className="text-tertiary-foreground px-1 text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
          >
            {timestamp}
          </time>
        </div>
        <Avatar className="size-8 shrink-0">
          {userImageUrl ? (
            <AvatarImage
              src={userImageUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
            {userName?.trim() ? userName.trim().charAt(0).toUpperCase() : "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  const chip = describeOutboxKind(message.kind, (key) => t(key));
  // Only the orchestrator's intro/welcome messages carry suggested prompts.
  const showSuggestions =
    onSelectSuggestion !== undefined &&
    (message.kind === "research_intro" ||
      message.kind === "welcome" ||
      message.kind === "returning");
  const suggestions = showSuggestions
    ? extractSuggestedPrompts(message.content)
    : [];

  // Detect orchestrator-pushed "confirmation_resolved" messages with a
  // sokosumi_create_task payload and split them into prose + task card so
  // the user doesn't have to read raw JSON in chat.
  const parsedConfirmation =
    message.kind === "confirmation_resolved"
      ? parseConfirmationResolved(message.content, {
          resolvedFallback: t("confirmation.resolvedFallback"),
          coworkerFallback: t("confirmation.taskCard.defaultCoworker"),
          organizationFallback: t("confirmation.taskCard.defaultOrganization"),
        })
      : null;

  return (
    <div className="group/message flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar accent={Boolean(chip)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {chip ? (
          <span className="border-border/60 text-tertiary-foreground bg-muted/40 inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {chip.label}
          </span>
        ) : null}
        {steps && steps.length > 0 ? (
          <MessageSteps
            steps={steps}
            countLabel={
              steps.length === 1 && steps[0]!.kind !== "reasoning"
                ? steps[0]!.label
                : t("toolSteps", { count: steps.length })
            }
          />
        ) : null}
        {parsedConfirmation ? (
          <div className="flex flex-col gap-3 pt-1 pr-10 pb-1">
            <p className="text-foreground text-sm leading-relaxed">
              {parsedConfirmation.summary}
            </p>
            {parsedConfirmation.task ? (
              <TaskResultCard task={parsedConfirmation.task} />
            ) : null}
          </div>
        ) : (
          <Markdown className="text-foreground pt-1 pr-10 pb-1 text-sm">
            {isStreaming ? `${message.content} ▌` : message.content}
          </Markdown>
        )}
        {suggestions.length > 0 ? (
          <div className="mt-4 mb-2 flex flex-col gap-2 pr-10 sm:flex-row sm:flex-wrap">
            {suggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSelectSuggestion?.(prompt)}
                className={cn(
                  "group/chip border-border bg-card hover:border-foreground/30 hover:bg-muted/40 text-foreground",
                  "inline-flex max-w-full items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium",
                  "transition-colors active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                <span className="truncate text-left">{prompt}</span>
                <span
                  aria-hidden
                  className="text-muted-foreground group-hover/chip:text-primary shrink-0 transition-transform group-hover/chip:translate-x-0.5"
                >
                  →
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2 pt-0.5 pb-2">
          {!isStreaming ? (
            <CopyButton
              text={message.content}
              label={t("copyAction")}
              copiedLabel={t("copiedAction")}
            />
          ) : null}
          {durationMs !== undefined && !isStreaming ? (
            <span className="text-tertiary-foreground text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100">
              {t("answeredIn", { seconds: Math.round(durationMs / 1000) })}
            </span>
          ) : null}
          <time
            dateTime={message.createdAt}
            className="text-tertiary-foreground text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
          >
            {timestamp}
          </time>
        </div>
      </div>
    </div>
  );
}

/** Collapsible disclosure of the tool/progress steps a turn went through —
 * keeps the reasoning legible after the answer has arrived. */
export function MessageSteps({
  steps,
  countLabel,
}: {
  steps: ProgressStep[];
  countLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pr-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded text-xs font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <Wrench aria-hidden className="size-3" />
        {countLabel}
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? (
        <div className="border-border/60 mt-1.5 flex flex-col gap-1.5 border-l pl-3">
          {steps.map((step, i) =>
            step.kind === "reasoning" ? (
              <p
                key={`${step.label}-${i}`}
                className="text-muted-foreground pl-[18px] text-xs italic"
              >
                {step.label}
              </p>
            ) : (
              <ToolStepRow key={`${step.label}-${i}`} step={step} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ToolStepRow({ step }: { step: ProgressStep }) {
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Check aria-hidden className="text-primary/60 mt-0.5 size-3 shrink-0" />
      <span className="min-w-0">
        <span className="text-foreground/80 font-medium">{step.label}</span>
        {step.detail ? (
          <span className="text-muted-foreground"> — {step.detail}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Hover-to-copy control for an assistant message. */
export function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? copiedLabel : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border/70 focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3.5" />
          {copiedLabel}
        </>
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

export interface OutboxKindChip {
  label: string;
}

export function describeOutboxKind(
  kind: string | null,
  t: (key: string) => string,
): OutboxKindChip | null {
  if (!kind || kind === "text") return null;
  if (kind === "welcome" || kind === "research_intro" || kind === "returning") {
    return { label: t("outboxKinds.welcome") };
  }
  if (kind === "daily_brief") return { label: t("outboxKinds.daily_brief") };
  if (kind === "job_complete") return { label: t("outboxKinds.job_complete") };
  if (kind === "task_result") return { label: t("outboxKinds.task_result") };
  if (kind === "daily_suggestions") {
    return { label: t("outboxKinds.daily_suggestions") };
  }
  if (kind === "reminder") return { label: t("outboxKinds.reminder") };
  if (kind === "confirmation_resolved") {
    return { label: t("outboxKinds.confirmation_resolved") };
  }
  return { label: t("outboxKinds.default") };
}
