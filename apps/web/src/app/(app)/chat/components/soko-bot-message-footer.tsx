"use client";

import {
  ArrowUpRight,
  CalendarClock,
  Clock,
  ListChecks,
  Mail,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { sendSokoBotTurnFeedbackAction } from "@/lib/actions/soko-bot/action";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface SokoBotMessageMetadata {
  turn_id: string;
  pending_decision_ids?: string[];
  task_ids?: string[];
  /** Set on messages the bot sent on its own (stand-up, ingest, events). */
  source?: string;
  schedule_name?: string;
  schedule_key?: string | null;
}

function readSokoBotMetadata(metadata: unknown): SokoBotMessageMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { soko_bot?: unknown }).soko_bot;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.turn_id !== "string") return null;
  const ids = (key: string) =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
  return {
    turn_id: record.turn_id,
    pending_decision_ids: ids("pending_decision_ids"),
    task_ids: ids("task_ids"),
    source: typeof record.source === "string" ? record.source : undefined,
    schedule_name:
      typeof record.schedule_name === "string"
        ? record.schedule_name
        : undefined,
    schedule_key:
      typeof record.schedule_key === "string" ? record.schedule_key : null,
  };
}

type SourceLabel =
  | { kind: "inbox" }
  | { kind: "standup" }
  | { kind: "weeklyWrap" }
  | { kind: "scheduled"; name: string }
  | { kind: "taskUpdate" };

/** Where a message the bot sent on its own came from; null for replies. */
export function sokoBotSourceLabel(metadata: unknown): SourceLabel | null {
  const info = readSokoBotMetadata(metadata);
  switch (info?.source) {
    case "INGEST":
      return { kind: "inbox" };
    case "EVENT":
      return { kind: "taskUpdate" };
    case "SCHEDULE":
      if (info.schedule_key === "standup") return { kind: "standup" };
      if (info.schedule_key === "weekly-wrap") return { kind: "weeklyWrap" };
      return info.schedule_name
        ? { kind: "scheduled", name: info.schedule_name }
        : null;
    default:
      return null;
  }
}

const SOURCE_ICONS = {
  inbox: Mail,
  standup: CalendarClock,
  weeklyWrap: CalendarClock,
  scheduled: Clock,
  taskUpdate: ListChecks,
} as const;

/** A quiet line above an unprompted bot message saying what triggered it. */
export function SokoBotSourceLabel({ metadata }: { metadata: unknown }) {
  const t = useTranslations("App.Chat.SokoBot.source");
  const label = sokoBotSourceLabel(metadata);
  if (!label) return null;
  const Icon = SOURCE_ICONS[label.kind];
  return (
    <div className="text-muted-foreground mb-1 inline-flex items-center gap-1.5 text-xs">
      <Icon aria-hidden className="size-3" />
      {label.kind === "scheduled"
        ? t("scheduled", { name: label.name })
        : t(label.kind)}
    </div>
  );
}

/**
 * Useful / Not useful thumbs for a bot message, rendered inside the message's
 * action toolbar (hover pill on desktop, action sheet on touch) so they take
 * no room under the message. Feeds the admin quality metric. After a rating
 * the chosen thumb stays filled and both are disabled.
 */
export function SokoBotFeedbackButtons({
  metadata,
  buttonClassName,
}: {
  metadata: unknown;
  buttonClassName: string;
}) {
  const t = useTranslations("App.Chat.SokoBot");
  const [sent, setSent] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();
  const info = readSokoBotMetadata(metadata);
  if (!info) return null;
  const turnId = info.turn_id;
  function send(useful: boolean) {
    startTransition(async () => {
      const result = await sendSokoBotTurnFeedbackAction({ turnId, useful });
      if (result.ok) setSent(useful);
    });
  }
  const options = [
    { useful: true, Icon: ThumbsUp, label: t("feedbackUseful") },
    { useful: false, Icon: ThumbsDown, label: t("feedbackNotUseful") },
  ];
  return (
    <>
      {options.map(({ useful, Icon, label }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="icon"
          className={buttonClassName}
          title={sent === useful ? t("feedbackThanks") : label}
          aria-label={label}
          aria-pressed={sent === useful}
          disabled={isPending || sent !== null}
          onClick={() => send(useful)}
        >
          <Icon
            aria-hidden
            className={cn("size-4", sent === useful && "fill-current")}
          />
        </Button>
      ))}
    </>
  );
}

/** True when `SokoBotMessageFooter` has approvals or Tasks to show. */
export function hasSokoBotMessageFooter(metadata: unknown): boolean {
  const info = readSokoBotMetadata(metadata);
  return (
    info != null &&
    ((info.pending_decision_ids?.length ?? 0) > 0 ||
      (info.task_ids?.length ?? 0) > 0)
  );
}

/**
 * Under a Soko Bot reply: approvals it is waiting on (resolved on the
 * assistant console) and the Tasks it created in this turn.
 */
export function SokoBotMessageFooter({ metadata }: { metadata: unknown }) {
  const t = useTranslations("App.Chat.SokoBot");
  const info = readSokoBotMetadata(metadata);
  if (!info) return null;
  const pending = info.pending_decision_ids?.length ?? 0;
  const tasks = info.task_ids ?? [];
  if (pending === 0 && tasks.length === 0) return null;

  const chip =
    "border-border bg-card press hover:border-tertiary hover:bg-card-background inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors";

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pending > 0 ? (
        <Link
          href={`${SOKO_BOT_ROUTE}?turn=${encodeURIComponent(info.turn_id)}`}
          className={`${chip} border-primary-tertiary text-foreground`}
        >
          <ShieldCheck aria-hidden className="text-primary size-3.5" />
          <span className="font-medium">
            {t("approvals", { count: pending })}
          </span>
          <span className="text-muted-foreground">{t("review")}</span>
          <ArrowUpRight aria-hidden className="size-3" />
        </Link>
      ) : null}
      {tasks.map((taskId) => (
        <Link
          key={taskId}
          href={`/tasks/${encodeURIComponent(taskId)}`}
          className={chip}
        >
          <span className="bg-primary size-1.5 rounded-full" aria-hidden />
          <span className="font-medium">{t("task")}</span>
          <ArrowUpRight aria-hidden className="size-3" />
        </Link>
      ))}
    </div>
  );
}
