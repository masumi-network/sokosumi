"use client";

import { ArrowUpRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatDelegation, ChatTurn } from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

import { AssistantAvatar } from "./assistant-avatar";
import { DecisionCard } from "./decision-card";
import {
  completedStepsForTurn,
  isActiveTurn,
  orbStateForTurn,
  progressChipsForTurn,
  turnKind,
} from "./timeline";
import { TurnExplain } from "./turn-explain";
import { TurnProgress } from "./turn-progress";

function useTimestamp() {
  const format = useFormatter();
  return (iso: string): string => {
    const date = new Date(iso);
    const sameDay = date.toDateString() === new Date().toDateString();
    return format.dateTime(
      date,
      sameDay
        ? { hour: "2-digit", minute: "2-digit" }
        : {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          },
    );
  };
}

export function UserRow({
  content,
  createdAt,
  userImageUrl,
  userName,
  muted = false,
}: {
  content: string;
  createdAt: string;
  userImageUrl?: string | null;
  userName?: string | null;
  muted?: boolean;
}) {
  const timestamp = useTimestamp();
  return (
    <div className="group/message flex w-full justify-end gap-3 px-4 py-0.5">
      <div className="flex max-w-[75%] flex-col items-end gap-0.5">
        <div
          className={cn(
            "bg-muted-foreground/10 text-foreground min-h-6 rounded-lg px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word",
            muted && "opacity-70",
          )}
        >
          {content}
        </div>
        <time
          dateTime={createdAt}
          className="text-muted-foreground px-1 text-[0.625rem] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
        >
          {timestamp(createdAt)}
        </time>
      </div>
      <Avatar className="size-8 shrink-0">
        {userImageUrl ? (
          <AvatarImage src={userImageUrl} alt="" referrerPolicy="no-referrer" />
        ) : null}
        <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
          {userName?.trim() ? userName.trim().charAt(0).toUpperCase() : "U"}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

/** Read-only assistant message (imported history). */
export function AssistantMarkdownRow({
  content,
  createdAt,
  chip,
  muted = false,
}: {
  content: string;
  createdAt: string;
  chip?: string | null;
  muted?: boolean;
}) {
  return (
    <div className="group/message flex min-h-11 w-full items-start gap-3 px-4 py-1.5">
      <AssistantAvatar className={cn(muted && "opacity-70")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {chip ? <KindChip>{chip}</KindChip> : null}
        <Markdown
          className={cn(
            "text-foreground pt-1 pr-10 pb-1 text-sm",
            muted && "text-muted-foreground",
          )}
        >
          {content}
        </Markdown>
        <MessageFooter text={content} createdAt={createdAt} />
      </div>
    </div>
  );
}

function KindChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-border/60 text-muted-foreground bg-muted/40 inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
      {children}
    </span>
  );
}

function MessageFooter({
  text,
  createdAt,
  durationMs,
}: {
  text: string;
  createdAt: string;
  durationMs?: number | null;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const timestamp = useTimestamp();
  return (
    <div className="flex items-center gap-2 pt-0.5 pb-2">
      <CopyButton text={text} />
      {durationMs ? (
        <span className="text-muted-foreground text-[0.625rem] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100">
          {t("answeredIn", {
            seconds: Math.max(1, Math.round(durationMs / 1000)),
          })}
        </span>
      ) : null}
      <time
        dateTime={createdAt}
        className="text-muted-foreground text-[0.625rem] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
      >
        {timestamp(createdAt)}
      </time>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("App.SokoBot.Chat");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? t("copied") : t("copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border/70 focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[0.6875rem] font-medium opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3.5" />
          {t("copied")}
        </>
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

/** One chip per Task/Job, showing its latest action (a turn may touch the same Task several times). */
function collapseDelegations(delegations: ChatDelegation[]): ChatDelegation[] {
  const byTarget = new Map<string, ChatDelegation>();
  for (const delegation of delegations) {
    const key = delegation.taskId ?? delegation.jobId ?? delegation.id;
    byTarget.set(key, delegation);
  }
  return Array.from(byTarget.values());
}

function DelegationChips({ delegations }: { delegations: ChatDelegation[] }) {
  const t = useTranslations("App.SokoBot.Chat.delegation");
  const collapsed = collapseDelegations(delegations);
  if (collapsed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pr-10">
      {collapsed.map((delegation) => {
        const href = delegation.taskId
          ? `/tasks/${encodeURIComponent(delegation.taskId)}`
          : delegation.jobId
            ? `/jobs/${encodeURIComponent(delegation.jobId)}`
            : null;
        const label = delegation.kind === "TASK" ? t("task") : t("job");
        const failed = delegation.outcome === "failed" || delegation.error;
        const body = (
          <>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                failed
                  ? "bg-semantic-destructive"
                  : delegation.outcome === "processing"
                    ? "bg-semantic-info"
                    : "bg-primary",
              )}
              aria-hidden
            />
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground truncate">
              {failed ? t("failed") : delegation.action.replaceAll("_", " ")}
            </span>
            {href ? (
              <ArrowUpRight aria-hidden className="size-3 shrink-0" />
            ) : null}
          </>
        );
        const className =
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/40 inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors";
        return href ? (
          <Link key={delegation.id} href={href} className={className}>
            {body}
          </Link>
        ) : (
          <span key={delegation.id} className={className}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

/**
 * One turn: the user's message on the right, then the assistant's answer (or
 * its live progress) with any approvals and delegated work inline.
 */
export function TurnRows({
  turn,
  userImageUrl,
  userName,
  onDecisionResolved,
}: {
  turn: ChatTurn;
  userImageUrl?: string | null;
  userName?: string | null;
  onDecisionResolved: () => void;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const active = isActiveTurn(turn);
  const kind = turnKind(turn);
  const startedAt = turn.startedAt ?? turn.createdAt;

  return (
    <>
      {kind === "scheduled" ? (
        <div className="flex w-full items-start gap-3 px-4 pt-3">
          <div className="size-8 shrink-0" aria-hidden />
          <KindChip>{t("kind.scheduled")}</KindChip>
        </div>
      ) : null}
      <UserRow
        content={turn.userMessage}
        createdAt={turn.createdAt}
        userImageUrl={userImageUrl}
        userName={userName}
        muted={kind === "scheduled"}
      />
      {active ? (
        <TurnProgress
          chips={progressChipsForTurn(turn)}
          startedAt={new Date(startedAt).getTime()}
          orbState={orbStateForTurn(turn)}
          cancelRequested={turn.status === "CANCEL_REQUESTED"}
        />
      ) : (
        <div className="group/message flex min-h-11 w-full items-start gap-3 px-4 py-1.5">
          <AssistantAvatar
            expression={turn.status === "FAILED" ? "focused" : "idle"}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {turn.finalAnswer ? (
              <Markdown className="text-foreground pt-1 pr-10 pb-1 text-sm">
                {turn.finalAnswer}
              </Markdown>
            ) : turn.status === "FAILED" ? (
              <p className="text-semantic-destructive pt-1 pr-10 text-sm">
                {turn.errorDetail ?? t("failed")}
              </p>
            ) : turn.status === "CANCELLED" ? (
              <p className="text-muted-foreground pt-1 pr-10 text-sm italic">
                {t("cancelled")}
              </p>
            ) : (
              <p className="text-muted-foreground pt-1 pr-10 text-sm italic">
                {t("noAnswer")}
              </p>
            )}
            <DelegationChips delegations={turn.delegations} />
            {turn.decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                onResolved={onDecisionResolved}
              />
            ))}
            <MessageFooter
              text={turn.finalAnswer ?? ""}
              createdAt={turn.completedAt ?? turn.createdAt}
              durationMs={turn.durationMs}
            />
            {turn.optimistic ? null : (
              <TurnExplain
                turnId={turn.id}
                stepCount={completedStepsForTurn(turn).length}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
