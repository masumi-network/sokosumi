"use client";

import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChatTurn } from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

import { TurnRows } from "../chat/message-row";
import { isActiveTurn, turnKind } from "../chat/timeline";

const PAGE_SIZE = 8;

function statusDotClass(turn: ChatTurn): string {
  if (isActiveTurn(turn)) return "bg-semantic-info animate-pulse";
  if (turn.status === "FAILED") return "bg-semantic-destructive";
  if (turn.status === "CANCELLED") return "bg-muted-foreground/40";
  if (turn.decisions.some((d) => d.status === "PENDING")) return "bg-primary";
  return "bg-muted-foreground/40";
}

/**
 * One turn folded to a single line: what was asked, how it was routed, by
 * whom and where, and when. Opens to the full transcript with approvals,
 * delegated work, and the explain view.
 */
function ActivityRow({
  turn,
  defaultOpen,
  highlighted,
  userImageUrl,
  userName,
  onDecisionResolved,
}: {
  turn: ChatTurn;
  defaultOpen: boolean;
  highlighted: boolean;
  userImageUrl: string | null;
  userName: string | null;
  onDecisionResolved: () => void;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const tRoute = useTranslations("Components.SokoBot.Route");
  const format = useFormatter();
  const [open, setOpen] = useState(defaultOpen);
  const kind = turnKind(turn);
  const summary = turn.userMessage.replace(/\s+/g, " ").trim();
  const when = format.relativeTime(new Date(turn.createdAt), new Date());

  return (
    <li id={`turn-${turn.id}`} className={cn(highlighted && "bg-primary/5")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(turn))}
        />
        <span className="text-foreground min-w-0 flex-1 truncate text-sm">
          {summary}
        </span>
        <span className="text-muted-foreground hidden shrink-0 items-center gap-2 text-xs sm:flex">
          {turn.route ? <span>{tRoute(turn.route)}</span> : null}
          {kind === "scheduled" ? <span>{t("kind.scheduled")}</span> : null}
          {turn.requestedBy ? (
            <span>
              {t("kind.askedBy", {
                name: turn.requestedBy.name ?? t("kind.teammate"),
              })}
            </span>
          ) : null}
          {turn.chatRoom && turn.chatRoom.kind !== "direct" ? (
            <span>{t("kind.inRoom", { room: turn.chatRoom.name ?? "" })}</span>
          ) : null}
        </span>
        <time
          dateTime={turn.createdAt}
          className="text-muted-foreground shrink-0 text-xs tabular-nums"
        >
          {when}
        </time>
      </button>
      {open ? (
        <div className="border-border/60 border-t pt-1 pb-2">
          <TurnRows
            turn={turn}
            userImageUrl={userImageUrl}
            userName={userName}
            onDecisionResolved={onDecisionResolved}
          />
        </div>
      ) : null}
    </li>
  );
}

export function ActivityList({
  turns,
  focusTurnId,
  userImageUrl,
  userName,
  onDecisionResolved,
}: {
  turns: ChatTurn[];
  focusTurnId: string | null;
  userImageUrl: string | null;
  userName: string | null;
  onDecisionResolved: () => void;
}) {
  const t = useTranslations("App.SokoBot.Console");
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? turns : turns.slice(0, PAGE_SIZE);
  const hidden = turns.length - visible.length;

  return (
    <div className="-mx-4 -my-4">
      <ol className="divide-y">
        {visible.map((turn) => (
          <ActivityRow
            key={turn.id}
            turn={turn}
            defaultOpen={isActiveTurn(turn) || focusTurnId === turn.id}
            highlighted={focusTurnId === turn.id}
            userImageUrl={userImageUrl}
            userName={userName}
            onDecisionResolved={onDecisionResolved}
          />
        ))}
      </ol>
      {hidden > 0 ? (
        <div className="border-t px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(true)}
          >
            {t("showMore", { count: hidden })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
