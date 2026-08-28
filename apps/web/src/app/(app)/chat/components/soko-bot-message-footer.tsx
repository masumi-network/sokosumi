"use client";

import { ArrowUpRight, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { sendSokoBotTurnFeedbackAction } from "@/lib/actions/soko-bot/action";

import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

interface SokoBotMessageMetadata {
  turn_id: string;
  pending_decision_ids?: string[];
  task_ids?: string[];
  /** Set on messages the bot sent on its own (stand-up, ingest, events). */
  source?: string;
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
  };
}

/** Thumbs on a message the bot sent unprompted; feeds the admin quality metric. */
function FeedbackButtons({ turnId }: { turnId: string }) {
  const t = useTranslations("App.Chat.SokoBot");
  const [sent, setSent] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();
  function send(useful: boolean) {
    startTransition(async () => {
      const result = await sendSokoBotTurnFeedbackAction({ turnId, useful });
      if (result.ok) setSent(useful);
    });
  }
  if (sent !== null) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        {sent ? (
          <ThumbsUp aria-hidden className="size-3" />
        ) : (
          <ThumbsDown aria-hidden className="size-3" />
        )}
        {t("feedbackThanks")}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <span className="mr-0.5">{t("feedbackAsk")}</span>
      <button
        type="button"
        aria-label={t("feedbackUseful")}
        disabled={isPending}
        onClick={() => send(true)}
        className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
      >
        <ThumbsUp aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("feedbackNotUseful")}
        disabled={isPending}
        onClick={() => send(false)}
        className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
      >
        <ThumbsDown aria-hidden className="size-3.5" />
      </button>
    </span>
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
  const proactive = Boolean(info.source && info.source !== "CHAT");
  if (pending === 0 && tasks.length === 0 && !proactive) return null;

  const chip =
    "border-border bg-card hover:border-foreground/30 hover:bg-muted/40 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors";

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pending > 0 ? (
        <Link
          href={`${SOKO_BOT_ROUTE}?turn=${encodeURIComponent(info.turn_id)}`}
          className={`${chip} border-primary/40 text-foreground`}
        >
          <ShieldCheck aria-hidden className="text-primary size-3.5" />
          <span className="font-medium">
            {t("approvals", { count: pending })}
          </span>
          <span className="text-muted-foreground">{t("review")}</span>
          <ArrowUpRight aria-hidden className="size-3" />
        </Link>
      ) : null}
      {proactive ? <FeedbackButtons turnId={info.turn_id} /> : null}
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
