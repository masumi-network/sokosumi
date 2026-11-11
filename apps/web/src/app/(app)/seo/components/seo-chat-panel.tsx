"use client";

import { ArrowUp, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { devicePrefersHover } from "@/lib/utils/device-prefers-hover";
import { SEO_ASK_BUTTON_ID } from "./seo-ask-button";
import {
  SeoChatComposer,
  SeoPromptChips,
  seoAgentPrompts,
} from "./seo-chat-composer";
import {
  SeoAgentOrb,
  SeoChatQuestion,
  SeoChatTurn,
  SeoChatWorking,
} from "./seo-chat-turn";
import { seoHasCompetitor } from "./seo-shared";
import { useSeoChat } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_CHAT_SHEET_INPUT_ID = "seo-chat-question";
/** Room above a reply that just landed, so its question is not on the edge. */
const LANDED_INSET_PX = 16;

type Chat = ReturnType<typeof useSeoChat>;

const threadId = (inputId: string) => `${inputId}-thread`;

/** The agent's face next to a title and one line of help. */
function SeoChatHeading({
  thinking = false,
  title,
  description,
}: {
  thinking?: boolean;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <SeoAgentOrb thinking={thinking} />
      <div className="min-w-0 space-y-0.5">
        {title}
        {description}
      </div>
    </div>
  );
}

/** A first visit: questions the reader can send with one click. */
function ChatWelcome({
  chat,
  inputId,
  competitors,
  searches,
}: {
  chat: Chat;
  inputId: string;
  competitors: boolean;
  searches: boolean;
}) {
  const t = useTranslations("App.Seo");
  return (
    // The sheet's header says what the agent does: the first visit shows the questions only.
    <div className="content-rise flex w-full flex-col gap-2 py-4">
      {seoAgentPrompts({ competitors, searches }).map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          className="h-auto min-h-10 justify-between gap-3 py-2 text-start whitespace-normal"
          onClick={() => {
            // These buttons leave with the greeting: focus moves to the
            // field, or to the thread where the field would open a keyboard.
            document
              .getElementById(
                devicePrefersHover() ? inputId : threadId(inputId),
              )
              ?.focus({ preventScroll: true });
            void chat.send(t(`agent.prompts.${prompt}`));
          }}
        >
          {t(`agent.prompts.${prompt}`)}
          <ArrowUp className="text-muted-foreground" />
        </Button>
      ))}
    </div>
  );
}

/** The conversation and its composer, inside the chat sheet. */
function SeoChatThread({
  model,
  chat,
  inputId,
  className,
}: {
  model: SeoWorkspaceModel;
  chat: Chat;
  inputId: string;
  className?: string;
}) {
  const t = useTranslations("App.Seo");
  // A new question stays in view: the thread follows its end. A reply to a
  // question sent from here starts at that question, so a long answer is read
  // from its first line.
  const thread = useRef<HTMLDivElement>(null);
  const newest = chat.turns.at(-1);
  const sent = chat.turns.find((turn) => turn.id === chat.sentId);
  const landed =
    Boolean(newest) && newest === sent && newest?.status !== "running";
  const follow = `${newest?.id}:${newest?.status}:${chat.pending !== null}`;
  useEffect(() => {
    const box = thread.current;
    if (!box) return;
    const last = box.querySelector<HTMLElement>("article:last-of-type");
    box.scrollTop =
      landed && last ? last.offsetTop - LANDED_INSET_PX : box.scrollHeight;
  }, [follow, landed]);
  // Spoken, and short: the question this panel sent is out, its reply has
  // landed, or its turn failed after the send. Old turns stay quiet, and a
  // send that fails speaks through the composer's alert.
  const announcement =
    chat.pending || sent?.status === "running"
      ? t("chat.asked")
      : sent?.status === "completed"
        ? t("chat.replied")
        : sent?.status === "failed" && !chat.error
          ? t("chat.failed")
          : "";
  const welcome =
    !chat.turns.length &&
    !chat.pending &&
    !chat.history.isPending &&
    !chat.history.isError;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div
        ref={thread}
        id={threadId(inputId)}
        role="group"
        aria-label={t("chat.title")}
        // Focusable, so the keyboard can scroll a thread of plain text.
        tabIndex={0}
        className="app-scrollbar focus-visible:ring-ring relative min-h-0 flex-1 space-y-6 overflow-y-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {chat.history.isPending ? (
          <div role="status" className="space-y-4">
            <span className="sr-only">{t("chat.loadingHistory")}</span>
            {/* A question on the trailing side, a reply past the agent's face. */}
            <Skeleton className="ms-auto h-9 w-2/3 rounded-lg" />
            <Skeleton className="ms-11 h-16 rounded-lg" />
          </div>
        ) : chat.history.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{t("chat.loadFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              loading={chat.history.isFetching}
              onClick={() => {
                void chat.history.refetch();
              }}
            >
              <RotateCw />
              {t("retry")}
            </Button>
          </div>
        ) : welcome ? (
          <ChatWelcome
            chat={chat}
            inputId={inputId}
            competitors={seoHasCompetitor(model.data)}
            searches={Boolean(model.data.searchQueries?.rows.length)}
          />
        ) : null}
        {chat.turns.map((turn) => (
          <SeoChatTurn
            key={turn.id}
            turn={turn}
            model={model}
            mine={
              turn.author?.id === chat.viewerId ||
              (!turn.author && chat.sharing === "personal")
            }
          />
        ))}
        {chat.pending ? (
          // The question shows at once, before Core has answered.
          <div className="content-rise space-y-3">
            <div className="flex flex-col items-end">
              <SeoChatQuestion text={chat.pending} />
            </div>
            <SeoChatWorking />
          </div>
        ) : null}
      </div>
      <div className="shrink-0 space-y-2 px-4 pb-4">
        {welcome ? null : (
          <SeoPromptChips
            busy={chat.busy}
            competitors={seoHasCompetitor(model.data)}
            searches={Boolean(model.data.searchQueries?.rows.length)}
            onPick={(question) => {
              void chat.send(question);
            }}
          />
        )}
        {chat.error ? (
          <p role="alert" className="text-destructive text-sm">
            {chat.error}
          </p>
        ) : null}
        <SeoChatComposer
          inputId={inputId}
          value={chat.question}
          onChange={chat.setQuestion}
          onSend={() => {
            void chat.send();
          }}
          busy={chat.busy}
          sharing={chat.sharing}
        />
      </div>
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
      <SheetContent
        // The sheet leaves the workspace, so it repeats its 40px phone buttons.
        className="w-full gap-0 sm:max-w-xl max-sm:[&_[data-slot=button]]:min-h-10 max-sm:[&_[data-slot=dropdown-menu-trigger]]:min-h-10"
        // The question field, not the first link of the oldest turn. On a
        // touch screen the field would open a keyboard over the thread.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document
            .getElementById(
              devicePrefersHover()
                ? SEO_CHAT_SHEET_INPUT_ID
                : threadId(SEO_CHAT_SHEET_INPUT_ID),
            )
            ?.focus();
        }}
        // The sheet has no trigger of its own: without this the focus falls to the page start.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(SEO_ASK_BUTTON_ID)?.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b pe-12">
          <SeoChatHeading
            thinking={chat.busy}
            title={<SheetTitle>{t("chat.title")}</SheetTitle>}
            description={
              <SheetDescription>{t("chat.description")}</SheetDescription>
            }
          />
        </SheetHeader>
        <SeoChatThread
          model={model}
          chat={chat}
          inputId={SEO_CHAT_SHEET_INPUT_ID}
          className="flex-1"
        />
      </SheetContent>
    </Sheet>
  );
}
