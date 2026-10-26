"use client";

import {
  type ChatResultPreview,
  type ChatRoomMessage,
  type ChatRoomMessageSender,
  ChatRoomSokoBotScope,
} from "@sokosumi/core-client";
import {
  ArrowUpRight,
  CalendarClock,
  Clock,
  Hourglass,
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
import { useSession } from "@/lib/auth/auth.client";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface SokoBotMessageMetadata {
  turn_id: string;
  pending_decision_ids?: string[];
  task_ids?: string[];
  /** Set on messages the bot sent on its own (stand-up, ingest, events). */
  source?: string;
  schedule_name?: string;
  schedule_key?: string | null;
  background_run_title?: string;
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
    background_run_title:
      typeof record.background_run_title === "string"
        ? record.background_run_title
        : undefined,
  };
}

type SourceLabel =
  | { kind: "inbox" }
  | { kind: "standup" }
  | { kind: "weeklyWrap" }
  | { kind: "scheduled"; name: string }
  | { kind: "background"; name: string }
  | { kind: "taskUpdate" };

/** Where a message the bot sent on its own came from; null for replies. */
export function sokoBotSourceLabel(metadata: unknown): SourceLabel | null {
  const info = readSokoBotMetadata(metadata);
  if (info?.background_run_title)
    return { kind: "background", name: info.background_run_title };
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

export const SOKO_BOT_SOURCE_ICONS = {
  inbox: Mail,
  standup: CalendarClock,
  weeklyWrap: CalendarClock,
  scheduled: Clock,
  background: Hourglass,
  taskUpdate: ListChecks,
} as const;

/** A quiet line above an unprompted bot message saying what triggered it. */
export function SokoBotSourceLabel({ metadata }: { metadata: unknown }) {
  const t = useTranslations("App.Chat.SokoBot.source");
  const label = sokoBotSourceLabel(metadata);
  if (!label) return null;
  const Icon = SOKO_BOT_SOURCE_ICONS[label.kind];
  return (
    <div className="text-muted-foreground mb-1 inline-flex items-center gap-1.5 text-xs">
      <Icon aria-hidden className="size-3" />
      {label.kind === "scheduled" || label.kind === "background"
        ? t(label.kind, { name: label.name })
        : t(label.kind)}
    </div>
  );
}

/** Core stores a rating only for the viewer's own personal bot. */
export function canRateSokoBotMessage(
  sender: ChatRoomMessageSender,
  viewerId: string | undefined,
): boolean {
  return (
    sender.type === "sokoBot" &&
    viewerId !== undefined &&
    sender.sokoBot.ownerUserId === viewerId
  );
}

/**
 * Useful / Not useful thumbs for a bot message, rendered inside the message's
 * action toolbar (hover pill on desktop, action sheet on touch) so they take
 * no room under the message. Feeds the admin quality metric. After a rating
 * the chosen thumb stays filled and both are disabled.
 */
export function SokoBotFeedbackButtons({
  message,
  buttonClassName,
}: {
  message: Pick<ChatRoomMessage, "metadata" | "sender">;
  buttonClassName: string;
}) {
  const t = useTranslations("App.Chat.SokoBot");
  const { data: session } = useSession();
  const [sent, setSent] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();
  const info = readSokoBotMetadata(message.metadata);
  if (!info || !canRateSokoBotMessage(message.sender, session?.user.id))
    return null;
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

/** The id of a project or workspace bot that sent a message, else null. */
export function sharedSokoBotId(sender: ChatRoomMessageSender): string | null {
  // Explicit, so a missing scope (an older Core) reads as personal.
  return sender.type === "sokoBot" &&
    (sender.sokoBot.scope === ChatRoomSokoBotScope.PROJECT ||
      sender.sokoBot.scope === ChatRoomSokoBotScope.WORKSPACE)
    ? sender.sokoBot.id
    : null;
}

/** Tasks a result preview already shows, so the footer skips them. */
export function previewedTaskIds(results: ChatResultPreview[]): string[] {
  return results.flatMap((result) =>
    result.state === "available" && result.kind === "task" && result.task
      ? [result.task.id]
      : [],
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
export function SokoBotMessageFooter({
  metadata,
  previewedTaskIds = [],
  sharedBotId = null,
}: {
  metadata: unknown;
  previewedTaskIds?: string[];
  /** A shared bot's approvals live on its own console. */
  sharedBotId?: string | null;
}) {
  const t = useTranslations("App.Chat.SokoBot");
  const info = readSokoBotMetadata(metadata);
  if (!info) return null;
  const pending = info.pending_decision_ids?.length ?? 0;
  const tasks = (info.task_ids ?? []).filter(
    (id) => !previewedTaskIds.includes(id),
  );
  if (pending === 0 && tasks.length === 0) return null;

  const chip =
    "border-border bg-card press hover:border-tertiary hover:bg-card-background inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors";

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pending > 0 ? (
        <Link
          href={`${sokoBotConsoleRoute(sharedBotId)}?turn=${encodeURIComponent(info.turn_id)}`}
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
