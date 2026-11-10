"use client";

import type { SeoAuditChatTurn } from "@sokosumi/core-client";
import {
  ArrowUpRight,
  ClipboardPlus,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AssistantOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoChatReply } from "./seo-chat-reply";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoDate } from "./seo-shared";
import type { SeoDialog, SeoWorkspaceModel } from "./use-seo-workspace";

const ACTION_LABELS = {
  page: "addPage",
  keyword: "keywords.add",
  competitor: "competitors.add",
  analysis: "runAnalysis",
  statistics: "syncStatistics",
  page_change: "pageChange.title",
} as const;
const ACTION_ICONS = {
  page: Plus,
  keyword: Plus,
  competitor: Plus,
  analysis: Play,
  statistics: RefreshCw,
  page_change: PencilLine,
} as const;
/** One seed, so the SEO agent has the same face in every Audit. */
const SEO_AGENT_SEED = "sokosumi-seo-agent";
/** The orb draws at this size; its class sets the size on screen. */
const ORB_DRAW_PX = 64;

/** The SEO agent's face. It moves only while the agent works or greets. */
export function SeoAgentOrb({
  live = false,
  thinking = false,
  className,
}: {
  live?: boolean;
  thinking?: boolean;
  className?: string;
}) {
  // The orb's own loop does not read the motion setting, so it stays still here.
  const still = useReducedMotion();
  return (
    <AssistantOrb
      seed={SEO_AGENT_SEED}
      size={ORB_DRAW_PX}
      animate={(live || thinking) && !still}
      expression={thinking ? "thinking" : live ? "happy" : null}
      className={cn(
        "ring-border size-8 shrink-0 rounded-full ring-1",
        className,
      )}
    />
  );
}

/** A question longer than this folds to three lines until the reader opens it. */
const QUESTION_PREVIEW_CHARS = 200;

function TurnQuestion({ text }: { text: string }) {
  const t = useTranslations("App.Seo.chat");
  const [open, setOpen] = useState(false);
  const long = text.length > QUESTION_PREVIEW_CHARS;
  return (
    <>
      <p
        className={cn(
          "text-sm whitespace-pre-wrap break-words",
          long && !open && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {long ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 py-1 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {t(open ? "showLess" : "showMore")}
        </Button>
      ) : null}
    </>
  );
}

function ChatActions({
  turn,
  model,
}: {
  turn: SeoAuditChatTurn;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  return (
    <div className="flex flex-wrap gap-2">
      {turn.actions.map((action, index) => {
        if (action.kind === "connect")
          return (
            <SeoConnectionButton
              key={`${action.provider}:${index}`}
              provider={action.provider}
              onConnected={() => {
                void model.result.refetch();
              }}
            />
          );
        if (action.kind === "task") {
          // The reply is history; the current workspace decides whether the action still exists.
          // Opportunity IDs stay stable across syncs; a fix belongs to one report.
          const current = model.data.actions.find(
            (row) =>
              row.id === action.actionId &&
              (row.kind === "opportunity" ||
                row.observationId === action.observationId),
          );
          if (!current) return null;
          return current.taskId ? (
            <Button
              key={`${action.actionId}:${index}`}
              asChild
              size="sm"
              variant="outline"
            >
              <Link href={`/tasks/${encodeURIComponent(current.taskId)}`}>
                <ArrowUpRight />
                {t("openTask")}
              </Link>
            </Button>
          ) : model.data.availableActions.canEdit ? (
            <Button
              key={`${action.actionId}:${index}`}
              size="sm"
              variant="outline"
              className="h-auto max-w-full py-1.5 text-start break-words whitespace-normal"
              loading={model.pending}
              onClick={() => {
                void model.createActionTask(current);
              }}
            >
              <ClipboardPlus />
              {t("chat.createTask", { title: current.title })}
            </Button>
          ) : null;
        }
        // Older replies may still suggest the removed report import.
        if (
          action.dialog === "import" ||
          (action.dialog === "analysis" &&
            !model.data.availableActions.canRequestAnalysis)
        )
          return null;
        const Icon = ACTION_ICONS[action.dialog];
        // A newer Core can name a dialog this build does not have.
        if (!Icon) return null;
        return (
          <Button
            key={`${action.dialog}:${index}`}
            variant="outline"
            size="sm"
            disabled={!model.data.availableActions.canEdit}
            onClick={() => {
              model.setChatOpen(false);
              model.setDialog(action.dialog as SeoDialog);
            }}
          >
            <Icon />
            {t(ACTION_LABELS[action.dialog])}
          </Button>
        );
      })}
    </div>
  );
}

/** A question, on the trailing side. Also drawn for a question still in flight. */
export function SeoChatQuestion({ text }: { text: string }) {
  return (
    <div className="bg-quinary max-w-[85%] rounded-lg px-3 py-2">
      <TurnQuestion text={text} />
    </div>
  );
}

/** The agent at work: its face and one moving line. */
export function SeoChatWorking() {
  const t = useTranslations("App.Seo");
  return (
    <div className="flex items-start gap-3">
      <SeoAgentOrb thinking className="mx-1 size-6" />
      <p className="reasoning-text-shine pt-0.5 text-sm">{t("chat.working")}</p>
    </div>
  );
}

/** One exchange: the question on the right, the agent's reply on the left. */
export function SeoChatTurn({
  turn,
  model,
  mine,
}: {
  turn: SeoAuditChatTurn;
  model: SeoWorkspaceModel;
  /** The reader asked this question. */
  mine: boolean;
}) {
  const t = useTranslations("App.Seo");
  const running = turn.status === "running";
  return (
    <article className="content-rise space-y-3">
      <div className="flex flex-col items-end gap-1">
        <p className={cn("text-xs font-medium", mine && "sr-only")}>
          {mine ? t("chat.you") : turn.author?.name || t("chat.member")}
        </p>
        <SeoChatQuestion text={turn.question} />
        <p className="text-muted-foreground text-xs">
          {t("chat.pages", { count: turn.scope.pageIds.length })} ·{" "}
          <SeoDate value={turn.createdAt} />
        </p>
      </div>
      {running ? (
        <SeoChatWorking />
      ) : (
        <div className="flex items-start gap-3">
          <SeoAgentOrb className="mx-1 size-6" />
          <div className="min-w-0 flex-1 space-y-3">
            {turn.status === "failed" ? (
              // No alert role: an old failed turn must not interrupt on load.
              // The composer announces a send that fails now.
              <p className="text-destructive pt-0.5 text-sm">
                {t("chat.failed")}
              </p>
            ) : (
              <>
                <SeoChatReply text={turn.response ?? ""} />
                <ChatActions turn={turn} model={model} />
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
