"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import RotatingMessages from "@/app/personal-assistant/components/rotating-messages";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";

import { AssistantAvatar } from "./assistant-context";
import { ThinkingOrb } from "./thinking-orb";
import type { ProgressStep } from "./types";

/** Transient chain-of-thought beat, shown live and superseded by the next
 * phase frame (held on screen ≥ REASONING_MIN_MS so it doesn't blink). */
export function ReasoningLine({ snippet }: { snippet: string }) {
  return (
    <div className="flex w-full items-start gap-3 px-4 pb-1">
      {/* Gutter aligns under the avatar shown by the indicator above. */}
      <div className="size-8 shrink-0" aria-hidden />
      <p className="reasoning-text-shine text-muted-foreground line-clamp-2 max-w-2xl pt-0.5 text-sm italic">
        {snippet}
      </p>
    </div>
  );
}

export function ProgressChips({
  chips,
  startedAt,
}: {
  chips: ProgressStep[];
  startedAt?: number | null;
}) {
  return (
    <div className="flex w-full items-start gap-3 px-4 py-1.5">
      {/* The active avatar — "focused" eyes while a tool runs, so it reads as
          working rather than just drafting (the typing indicator stays
          "thinking"). */}
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-primary/30 absolute inset-0 animate-ping rounded-full"
        />
        <AssistantAvatar animated expression="focused" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-1">
        {chips.map((chip, i) => {
          const isLast = i === chips.length - 1;
          return (
            <div
              key={`${chip.id ?? chip.label}-${i}`}
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
              <span className="text-foreground shrink-0 font-medium">
                {chip.label}
              </span>
              {chip.detail ? (
                <span className="text-muted-foreground truncate">
                  {chip.detail}
                </span>
              ) : null}
              {isLast && startedAt ? (
                <ElapsedTimer startedAt={startedAt} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pool of "thinking" messages that cycle while Hermes drafts a reply. Mix
 * of straight-faced and lightly silly so users have something to read
 * during long inference runs without it feeling robotic. Each phrase
 * stands on its own — no trailing ellipsis here, the typing dots animate
 * separately. New phrases welcome, just keep them short.
 */
/** Live "Ns" counter since the turn started — keeps a long wait legible. */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
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

export function AssistantTyping({ startedAt }: { startedAt?: number | null }) {
  const t = useTranslations("App.Hermes.Running");
  const thinkingMessages = orderedMessageList(
    t.raw("thinkingMessages") as Record<string, string>,
  );
  // Escalate reassurance on long waits so a 30s+ turn doesn't read as stuck.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const secs = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const escalation =
    secs >= 40 ? t("stillWorkingLong") : secs >= 15 ? t("stillWorking") : null;

  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      {/* Avatar with a slow pulse ring so it reads as "working" at a glance */}
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-primary/30 absolute inset-0 animate-ping rounded-full"
        />
        <AssistantAvatar animated expression="thinking" />
      </span>

      {/* Rotating phrase + the purple thinking orb. Phrase change has its
          own fade (from RotatingMessages); the orb animates independently so
          there is always something moving even between fades. */}
      <div className="flex min-h-5 items-center gap-1.5 pt-2">
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
        <ThinkingOrb size={20} state="solving" />
        {startedAt ? <ElapsedTimer startedAt={startedAt} /> : null}
      </div>
    </div>
  );
}
