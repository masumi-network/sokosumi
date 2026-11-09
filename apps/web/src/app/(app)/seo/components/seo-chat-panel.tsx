"use client";

import type { SeoAuditChatTurn } from "@sokosumi/core-client";
import { Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoDate, SeoEmpty } from "./seo-shared";
import { SEO_CHAT_QUESTION_LIMIT, useSeoChat } from "./use-seo-chat";
import type { SeoDialog, SeoWorkspaceModel } from "./use-seo-workspace";

const ACTION_LABELS = {
  page: "addPage",
  keyword: "keywords.add",
  competitor: "competitors.add",
  import: "importAudit",
  analysis: "runAnalysis",
  statistics: "syncStatistics",
  page_change: "pageChange.title",
} as const;
export const SEO_AGENT_PROMPTS = ["first", "queries", "competitors"] as const;
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

type Chat = ReturnType<typeof useSeoChat>;

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
                {t("openTask")}
              </Link>
            </Button>
          ) : model.data.availableActions.canEdit ? (
            <Button
              key={`${action.actionId}:${index}`}
              size="sm"
              variant="outline"
              className="h-auto max-w-full py-1.5 text-left break-words whitespace-normal"
              loading={model.pending}
              onClick={() => {
                void model.createActionTask(current);
              }}
            >
              {t("chat.createTask", { title: current.title })}
            </Button>
          ) : null;
        }
        if (
          action.dialog === "analysis" &&
          !model.data.availableActions.canRequestAnalysis
        )
          return null;
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
            {t(ACTION_LABELS[action.dialog])}
          </Button>
        );
      })}
    </div>
  );
}

/** The conversation and its composer. Rendered inline on the agent home and inside the sheet. */
export function SeoChatThread({
  model,
  chat,
  inputId,
  className,
  latestOnly = false,
  compactPrompts = false,
}: {
  model: SeoWorkspaceModel;
  chat: Chat;
  inputId: string;
  className?: string;
  /** Show only this visit's exchanges until the reader asks for earlier ones. */
  latestOnly?: boolean;
  /** Below md, show only the first suggested prompt, so an inline chat does not push the page down. */
  compactPrompts?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const [showAll, setShowAll] = useState(!latestOnly);
  const seen = chat.seen;
  // The button unmounts on click; move focus to the earliest question it revealed.
  const revealed = useRef(false);
  const firstTurn = useRef<HTMLElement>(null);
  useEffect(() => {
    if (showAll && revealed.current) firstTurn.current?.focus();
  }, [showAll]);
  // Turns are oldest first. An earlier visit's answer is history, not today's brief.
  const firstThisVisit = seen
    ? chat.turns.findIndex((turn) => !seen.has(turn.id))
    : 0;
  const earlier =
    showAll || !seen
      ? 0
      : firstThisVisit === -1
        ? chat.turns.length
        : firstThisVisit;
  const turns = chat.turns.slice(earlier);
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        // A thread folded to its "earlier questions" link needs no full padding.
        className={cn(
          "min-h-0 flex-1 space-y-5 overflow-y-auto p-4",
          earlier &&
            !turns.length &&
            !chat.sending &&
            !chat.history.isError &&
            "py-1",
        )}
        aria-live="polite"
        aria-busy={chat.busy}
      >
        {chat.history.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("loading")}
          </p>
        ) : chat.history.isError ? (
          <div role="alert" className="space-y-2">
            <p>{t("chat.loadFailed")}</p>
            <Button
              variant="outline"
              onClick={() => {
                void chat.history.refetch();
              }}
            >
              {t("retry")}
            </Button>
          </div>
        ) : !chat.turns.length ? (
          <SeoEmpty title={t("chat.empty")} body={t("chat.emptyBody")} />
        ) : null}
        {earlier ? (
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => {
              revealed.current = true;
              setShowAll(true);
            }}
          >
            {t("chat.showEarlier", { count: earlier })}
          </Button>
        ) : null}
        {turns.map((turn, index) => (
          <article
            key={turn.id}
            ref={index === 0 ? firstTurn : undefined}
            tabIndex={index === 0 && revealed.current ? -1 : undefined}
            className="focus-visible:outline-ring space-y-3 border-b pb-5 focus-visible:outline-2"
          >
            <div className="bg-muted ml-6 rounded-lg px-3 py-2">
              <p className="mb-1 text-xs font-medium">
                {turn.author?.id === chat.viewerId ||
                (!turn.author && chat.sharing === "personal")
                  ? t("chat.you")
                  : turn.author?.name || t("chat.member")}
              </p>
              <TurnQuestion text={turn.question} />
            </div>
            <p className="text-muted-foreground text-xs">
              {t("chat.pages", { count: turn.scope.pageIds.length })} ·{" "}
              <SeoDate value={turn.createdAt} />
            </p>
            {turn.status === "running" ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t("chat.working")}
              </p>
            ) : turn.status === "failed" ? (
              <p role="alert" className="text-destructive text-sm">
                {t("chat.failed")}
              </p>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap">{turn.response}</p>
                <ChatActions turn={turn} model={model} />
              </>
            )}
          </article>
        ))}
        {chat.sending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("chat.working")}
          </p>
        ) : null}
      </div>
      <form
        className="shrink-0 space-y-3 border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void chat.send();
        }}
      >
        <div className="flex flex-wrap gap-2">
          {SEO_AGENT_PROMPTS.map((prompt, index) => (
            <Button
              key={prompt}
              type="button"
              size="sm"
              variant="outline"
              // A long prompt wraps inside the panel instead of running past it on a phone.
              className={cn(
                "h-auto max-w-full py-1.5 text-start whitespace-normal",
                compactPrompts && index > 0 && "max-md:hidden",
              )}
              disabled={chat.busy}
              onClick={() => {
                void chat.send(t(`agent.prompts.${prompt}`));
              }}
            >
              {t(`agent.prompts.${prompt}`)}
            </Button>
          ))}
        </div>
        <Label htmlFor={inputId}>{t("chat.question")}</Label>
        <Textarea
          id={inputId}
          value={chat.question}
          onChange={(event) => chat.setQuestion(event.target.value)}
          maxLength={SEO_CHAT_QUESTION_LIMIT}
          rows={3}
          required
          disabled={chat.busy}
        />
        {chat.error ? (
          <p role="alert" className="text-destructive text-sm">
            {chat.error}
          </p>
        ) : null}
        <Button
          type="submit"
          loading={chat.busy}
          disabled={chat.busy || !chat.question.trim()}
        >
          <Send className="size-4" />
          {t("chat.send")}
        </Button>
        {/* Who can read the chat sits next to Send, where it matters. */}
        <p className="text-muted-foreground text-xs">
          {t(chat.sharing === "organization" ? "chat.shared" : "chat.private")}
        </p>
      </form>
    </div>
  );
}

/** Keyed by viewer and Audit so a changed account never shows a stale conversation. */
export function useSeoChatIdentity(model: SeoWorkspaceModel) {
  const { data: session } = useSession();
  return JSON.stringify([
    session?.session.activeOrganizationId,
    session?.user.id,
    model.data.auditId,
  ]);
}

export function SeoChatPanel({ model }: { model: SeoWorkspaceModel }) {
  const identity = useSeoChatIdentity(model);
  return <SeoChatSheet key={identity} model={model} />;
}

function SeoChatSheet({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const chat = useSeoChat(model);
  const { chatDraft, setChatDraft } = model;
  const { setQuestion, sending } = chat;
  // A send in flight clears the input when it lands; the draft waits for it and keeps
  // any unsent text the user typed.
  useEffect(() => {
    if (!chatDraft || sending) return;
    setQuestion((typed) =>
      typed.trim() ? `${typed.trimEnd()}\n\n${chatDraft}` : chatDraft,
    );
    setChatDraft(null);
  }, [chatDraft, sending, setChatDraft, setQuestion]);
  return (
    <Sheet open={model.chatOpen} onOpenChange={model.setChatOpen}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b pr-12">
          <SheetTitle>{t("chat.title")}</SheetTitle>
          <SheetDescription>{t("chat.description")}</SheetDescription>
        </SheetHeader>
        <SeoChatThread
          model={model}
          chat={chat}
          inputId="seo-chat-question"
          className="flex-1"
        />
      </SheetContent>
    </Sheet>
  );
}
