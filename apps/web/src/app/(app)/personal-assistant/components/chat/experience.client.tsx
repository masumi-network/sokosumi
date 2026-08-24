"use client";

import { getFirstName } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import {
  cancelSokoBotTurnAction,
  startSokoBotTurnAction,
} from "@/lib/actions/soko-bot/action";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { SOKO_BOT_BUSY_ERROR_CODE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { AssistantSeedContext } from "./assistant-avatar";
import { Composer } from "./composer";
import { DecisionCard } from "./decision-card";
import { HeaderChips, type PanelKey } from "./header-chips";
import { AssistantMarkdownRow, TurnRows, UserRow } from "./message-row";
import { BotPanels } from "./panels";
import { isActiveTurn, orderedTurns, orphanPendingDecisions } from "./timeline";
import { useChatScroll } from "./use-chat-scroll";
import { useSokoBotState } from "./use-soko-bot-state";
import { WelcomeBlock } from "./welcome-block";

interface PendingSubmission {
  message: string;
  clientTurnId: string;
}

export interface SokoBotExperienceProps {
  initialState: SokoBotChatState;
  userName: string | null;
  userImageUrl: string | null;
}

/**
 * The Soko Bot chat surface. Full-bleed inside the app shell (same idiom as
 * `/chat`), timeline above a glowing composer, controls as floating chips.
 */
export function SokoBotExperience({
  initialState,
  userName,
  userImageUrl,
}: SokoBotExperienceProps) {
  const t = useTranslations("App.SokoBot.Chat");
  const {
    state,
    refresh,
    addOptimisticTurn,
    bindOptimisticTurn,
    dropOptimisticTurn,
  } = useSokoBotState(initialState);
  const { bot } = state;
  const botName = bot.name?.trim() || t("defaultName");
  const seed = bot.avatarSeed ?? defaultOrbSeed(bot.userId);

  const [input, setInput] = useState("");
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(null);
  const [isSending, startSend] = useTransition();
  const [isStopping, startStop] = useTransition();
  const pendingRef = useRef<PendingSubmission | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const turns = useMemo(() => orderedTurns(state), [state]);
  const orphans = useMemo(() => orphanPendingDecisions(state), [state]);
  const activeTurn = turns.find(isActiveTurn) ?? null;
  const legacy = bot.legacyMessages;
  const isEmpty =
    turns.length === 0 && legacy.length === 0 && orphans.length === 0;
  const paused = bot.status === "PAUSED";

  const { scrollerRef, atBottom, handleScrollerScroll, scrollToBottom } =
    useChatScroll({
      rowCount: turns.length + legacy.length + orphans.length,
      isEmpty,
    });

  const submissionFor = useCallback((trimmed: string): PendingSubmission => {
    const current = pendingRef.current;
    if (current && current.message === trimmed) return current;
    const next = { message: trimmed, clientTurnId: crypto.randomUUID() };
    pendingRef.current = next;
    return next;
  }, []);

  const send = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending || activeTurn || paused) return;
    const submission = submissionFor(trimmed);
    addOptimisticTurn(submission.clientTurnId, submission.message);
    setInput("");
    startSend(async () => {
      let result: Awaited<ReturnType<typeof startSokoBotTurnAction>>;
      try {
        result = await startSokoBotTurnAction({
          input: {
            clientTurnId: submission.clientTurnId,
            message: submission.message,
          },
        });
      } catch {
        dropOptimisticTurn(submission.clientTurnId);
        setInput(submission.message);
        toast.error(t("errors.send"));
        return;
      }
      if (!result.ok) {
        dropOptimisticTurn(submission.clientTurnId);
        setInput(submission.message);
        const busy = result.error.code === SOKO_BOT_BUSY_ERROR_CODE;
        toast.error(
          busy ? t("errors.busy") : (result.error.message ?? t("errors.send")),
        );
        if (busy) void refresh();
        return;
      }
      pendingRef.current = null;
      bindOptimisticTurn(submission.clientTurnId, result.value.turnId);
      void refresh();
    });
  }, [
    activeTurn,
    addOptimisticTurn,
    bindOptimisticTurn,
    dropOptimisticTurn,
    input,
    isSending,
    paused,
    refresh,
    submissionFor,
    t,
  ]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      send();
    },
    [send],
  );

  const stop = useCallback(() => {
    if (!activeTurn || activeTurn.optimistic) return;
    const turnId = activeTurn.id;
    startStop(async () => {
      const result = await cancelSokoBotTurnAction({ turnId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("errors.cancel"));
        return;
      }
      void refresh();
    });
  }, [activeTurn, refresh, t]);

  const handleSuggestion = useCallback((prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  }, []);

  const firstName = getFirstName(userName) ?? null;

  return (
    <AssistantSeedContext.Provider value={seed}>
      <div
        className={cn(
          "bg-background relative -m-4 flex min-h-0 min-w-0 flex-col overflow-hidden",
          CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
        )}
      >
        <HeaderChips
          autonomyLevel={bot.autonomyLevel}
          scheduleCount={bot.schedules.length}
          onOpen={setOpenPanel}
        />

        <div
          ref={scrollerRef}
          onScroll={handleScrollerScroll}
          className="scrollbar-none min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {isEmpty ? (
            <WelcomeBlock
              firstName={firstName}
              botName={botName}
              onSelectSuggestion={handleSuggestion}
            />
          ) : (
            <div className="flex flex-col items-center pt-16 pb-6">
              <div className="flex w-full max-w-3xl flex-col gap-1">
                {legacy.length > 0 ? (
                  <>
                    <p className="text-muted-foreground px-4 pb-2 text-center text-xs">
                      {t("legacyDivider", { count: legacy.length })}
                    </p>
                    {legacy.map((message) =>
                      message.role === "user" ? (
                        <UserRow
                          key={message.id}
                          content={message.content}
                          createdAt={message.createdAt}
                          userImageUrl={userImageUrl}
                          userName={userName}
                          muted
                        />
                      ) : (
                        <AssistantMarkdownRow
                          key={message.id}
                          content={message.content}
                          createdAt={message.createdAt}
                          muted
                        />
                      ),
                    )}
                    <div className="border-border/60 mx-4 my-3 border-t" />
                  </>
                ) : null}
                {turns.map((turn) => (
                  <TurnRows
                    key={turn.id}
                    turn={turn}
                    userImageUrl={userImageUrl}
                    userName={userName}
                    onDecisionResolved={refresh}
                  />
                ))}
                {orphans.length > 0 ? (
                  <div className="flex w-full items-start gap-3 px-4 py-1.5">
                    <div className="size-8 shrink-0" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {orphans.map((decision) => (
                        <DecisionCard
                          key={decision.id}
                          decision={decision}
                          onResolved={refresh}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <Composer
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          onStop={stop}
          isReplying={activeTurn !== null}
          isStopping={isStopping || activeTurn?.status === "CANCEL_REQUESTED"}
          isSending={isSending}
          paused={paused}
          botName={botName}
          atBottom={atBottom}
          isEmpty={isEmpty}
          onScrollToBottom={scrollToBottom}
        />

        <BotPanels
          bot={bot}
          openPanel={openPanel}
          onOpenChange={setOpenPanel}
        />
      </div>
    </AssistantSeedContext.Provider>
  );
}
