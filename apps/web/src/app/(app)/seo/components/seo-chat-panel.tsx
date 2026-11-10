"use client";

import { ArrowUp, Lock, RotateCw, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { resolveComposerEnterAction } from "@/lib/utils/composer-wysiwyg-input-rules";
import { devicePrefersHover } from "@/lib/utils/device-prefers-hover";
import {
  SeoAgentOrb,
  SeoChatQuestion,
  SeoChatTurn,
  SeoChatWorking,
} from "./seo-chat-turn";
import { SEO_CHAT_QUESTION_LIMIT, useSeoChat } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export const SEO_AGENT_PROMPTS = ["first", "queries", "competitors"] as const;

const SEO_CHAT_SHEET_INPUT_ID = "seo-chat-question";
/** An IME reports this key code for the Enter that confirms a composition. */
const IME_KEY_CODE = 229;
/** Room above a reply that just landed, so its question is not on the edge. */
const LANDED_INSET_PX = 16;

type Chat = ReturnType<typeof useSeoChat>;

const threadId = (inputId: string) => `${inputId}-thread`;

/** The agent's face next to a title and one line of help. Shared by the inline card and the sheet. */
export function SeoChatHeading({
  chat,
  title,
  description,
}: {
  chat: Chat;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <SeoAgentOrb thinking={chat.busy} />
      <div className="min-w-0 space-y-0.5">
        {title}
        {description}
      </div>
    </div>
  );
}

/** A first visit: a greeting and questions the reader can send with one click. */
function ChatWelcome({ chat, inputId }: { chat: Chat; inputId: string }) {
  const t = useTranslations("App.Seo");
  return (
    <div className="content-rise flex flex-col items-center gap-4 py-4 text-center">
      <SeoAgentOrb live className="size-12" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-balance">{t("chat.empty")}</p>
        <p className="text-muted-foreground text-sm">{t("chat.emptyBody")}</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {SEO_AGENT_PROMPTS.map((prompt) => (
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
  const Sharing = chat.sharing === "organization" ? Users : Lock;
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
        // A thread folded to its "earlier questions" link needs no full padding.
        className={cn(
          "app-scrollbar focus-visible:ring-ring relative min-h-0 flex-1 space-y-6 overflow-y-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset",
          earlier &&
            !turns.length &&
            !chat.pending &&
            !chat.history.isError &&
            "py-1",
        )}
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
          <ChatWelcome chat={chat} inputId={inputId} />
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
          <SeoChatTurn
            key={turn.id}
            turn={turn}
            model={model}
            mine={
              turn.author?.id === chat.viewerId ||
              (!turn.author && chat.sharing === "personal")
            }
            ref={index === 0 ? firstTurn : undefined}
            tabIndex={index === 0 && revealed.current ? -1 : undefined}
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
          <div className="flex flex-wrap gap-2">
            {SEO_AGENT_PROMPTS.map((prompt, index) => (
              <button
                key={prompt}
                type="button"
                // The app's prompt chip: a quiet pill that wraps inside the panel on a phone.
                className={cn(
                  "border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring press inline-flex min-h-8 max-w-full items-center rounded-full border px-3 py-1 text-start text-sm transition-colors outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 max-sm:min-h-10",
                  compactPrompts && index > 0 && "max-md:hidden",
                )}
                // Not the disabled attribute: that drops focus from the chip just pressed.
                aria-disabled={chat.busy || undefined}
                onClick={() => {
                  void chat.send(t(`agent.prompts.${prompt}`));
                }}
              >
                {t(`agent.prompts.${prompt}`)}
              </button>
            ))}
          </div>
        )}
        {chat.error ? (
          <p role="alert" className="text-destructive text-sm">
            {chat.error}
          </p>
        ) : null}
        <RoomMessageComposer
          withOuterPadding={false}
          withSafeAreaPadding={false}
          onSubmit={(event) => {
            event.preventDefault();
            void chat.send();
          }}
          attachments={[]}
          onRemoveAttachment={() => {}}
          removeAttachmentLabel={(name) => name}
          isSending={chat.busy}
          sendDisabled={!chat.question.trim()}
          sendAriaLabel={t("chat.send")}
          // Send keeps the app composer's filled style in every chat, next to
          // this page's own primary button.
          toolbarStart={
            // Who can read the chat sits next to Send, where it matters.
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
              <Sharing className="size-3.5 shrink-0" />
              <span className="min-w-0">
                {t(
                  chat.sharing === "organization"
                    ? "chat.sharedShort"
                    : "chat.privateShort",
                )}
              </span>
            </span>
          }
        >
          <Textarea
            id={inputId}
            aria-label={t("chat.question")}
            aria-describedby={`${inputId}-sharing`}
            placeholder={t("chat.placeholder")}
            className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
            value={chat.question}
            onChange={(event) => chat.setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.altKey ||
                event.nativeEvent.isComposing ||
                // Safari ends the composition before this event.
                event.keyCode === IME_KEY_CODE
              )
                return;
              // The app's composer rule: Enter sends, a modifier or a touch
              // keyboard starts a new line.
              const action = resolveComposerEnterAction({
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
                isSuggestionKeyboardActive: false,
                isTouchDevice: !devicePrefersHover(),
              });
              if (action === "submit") {
                event.preventDefault();
                void chat.send();
              } else if (event.metaKey || event.ctrlKey) {
                // A text field starts no line on Ctrl or Cmd+Enter by itself.
                event.preventDefault();
                const field = event.currentTarget;
                const { selectionStart, selectionEnd, value } = field;
                // The field's own limit does not cover an edit made here.
                if (
                  value.length - (selectionEnd - selectionStart) >=
                  SEO_CHAT_QUESTION_LIMIT
                )
                  return;
                field.setRangeText("\n", selectionStart, selectionEnd, "end");
                // React keeps its own record of the field's value. The input
                // event brings that record in step, so the next edit counts.
                field.dispatchEvent(new Event("input", { bubbles: true }));
                chat.setQuestion(field.value);
              }
            }}
            maxLength={SEO_CHAT_QUESTION_LIMIT}
            rows={1}
            required
          />
        </RoomMessageComposer>
        {/* Hidden text still describes the field, and is not read a second time. */}
        <p id={`${inputId}-sharing`} hidden>
          {t(chat.sharing === "organization" ? "chat.shared" : "chat.private")}
        </p>
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
        className="w-full gap-0 sm:max-w-xl max-sm:[&_[data-slot=button]]:min-h-10"
        // The question field, not the first link of the oldest turn.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(SEO_CHAT_SHEET_INPUT_ID)?.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b pe-12">
          <SeoChatHeading
            chat={chat}
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
