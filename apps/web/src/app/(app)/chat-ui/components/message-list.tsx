"use client";

import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AssistantAvatarContent } from "@/app/chat/components/assistant-avatar-content";
import ChatMessage from "@/app/chat/components/chat-message";
import DaySeparator from "@/app/chat/components/day-separator";
import LoadingIndicator from "@/app/chat/components/loading-indicator";
import { useScrollToBottom } from "@/app/chat/hooks/use-scroll-to-bottom";
import {
  formatDaySeparator,
  isDifferentDay,
} from "@/app/chat/utils/date-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import {
  extractMessageContent,
  extractReasoningStepMessages,
  getMessageFileParts,
  getThoughtTimingMsFromMessage,
  hasMessageTextOrFileParts,
} from "@/app/chat-ui/utils/message-utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import ReasoningLoaders from "./reasoning-loaders";
import ThoughtSummaryBar from "./thought-summary-bar";

export type MessageListHandle = Record<string, never>;

const WARMUP_READY_DELAY_MS = 3_000;
const WARMUP_SLOW_DELAY_MS = 8_000;

type WarmupMessagePhase = "thinking" | "ready" | "slow";

function groupMessagesIntoSection(messages: UIMessage[]): UIMessage[][] {
  if (messages.length === 0) return [];
  const sections: UIMessage[][] = [];
  let current: UIMessage[] = [];
  for (const msg of messages) {
    const role = msg.role as string;
    if (role === "user") {
      if (current.length > 0) {
        sections.push(current);
        current = [];
      }
      current.push(msg);
    } else {
      current.push(msg);
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

function getCreatedAtFromUiMessage(message: UIMessage): Date | undefined {
  if (!("createdAt" in message)) return undefined;
  const createdAtValue = message.createdAt;
  if (createdAtValue instanceof Date) return createdAtValue;
  if (
    typeof createdAtValue === "string" ||
    typeof createdAtValue === "number"
  ) {
    return new Date(createdAtValue);
  }
  return undefined;
}

function getLastDatedMessageCreatedAtBefore(
  messages: UIMessage[],
  index: number,
): Date | undefined {
  for (let j = index - 1; j >= 0; j--) {
    const d = getCreatedAtFromUiMessage(messages[j]);
    if (d !== undefined) return d;
  }
  return undefined;
}

interface MessageListProps {
  messages: UIMessage[];
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
  userImageUrl: string;
  userName?: string;
  isLoading: boolean;
  conversationCoworkerFallback?: {
    id: string;
    name?: string;
    avatar?: string | null;
  } | null;
  reasoningMessages?: Array<{ id: string; message: string }>;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
  isCoworker?: boolean;
  onResendLastMessage?: (lastUserMessage: UIMessage) => void;
  userTailRecoveryFailed?: boolean;
  coworkerResponseInProgress?: boolean;
  listRevision?: number;
  warmupPending?: boolean;
  warmupCoworkerName?: string;
}

const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  function MessageList(
    {
      messages,
      selectedChatId,
      chats,
      coworkers = [],
      userImageUrl,
      userName,
      isLoading,
      conversationCoworkerFallback = null,
      reasoningMessages = [],
      reasoningStartedAt,
      reasoningEndedAt,
      isCoworker = false,
      onResendLastMessage,
      userTailRecoveryFailed = false,
      coworkerResponseInProgress = false,
      listRevision = 0,
      warmupPending = false,
      warmupCoworkerName,
    },
    ref,
  ) {
    const t = useTranslations("App.Chat.Chat");
    const {
      containerRef: scrollContainerRef,
      endRef,
      scrollToMax,
    } = useScrollToBottom();
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const roRef = useRef<ResizeObserver | null>(null);
    const [contentHeight, setContentHeight] = useState(0);
    const [warmupMessagePhase, setWarmupMessagePhase] =
      useState<WarmupMessagePhase>("thinking");

    useImperativeHandle(ref, () => ({}), []);

    useEffect(() => {
      if (!warmupPending) {
        setWarmupMessagePhase("thinking");
        return;
      }

      setWarmupMessagePhase("thinking");

      const readyTimer = window.setTimeout(() => {
        setWarmupMessagePhase("ready");
      }, WARMUP_READY_DELAY_MS);
      const slowTimer = window.setTimeout(() => {
        setWarmupMessagePhase("slow");
      }, WARMUP_SLOW_DELAY_MS);

      return () => {
        window.clearTimeout(readyTimer);
        window.clearTimeout(slowTimer);
      };
    }, [selectedChatId, warmupPending]);

    const setWrapperRef = useCallback((el: HTMLDivElement | null) => {
      if (wrapperRef.current && roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      wrapperRef.current = el;
      if (el) {
        setContentHeight(el.clientHeight);
        roRef.current = new ResizeObserver(() => {
          setContentHeight(el.clientHeight);
        });
        roRef.current.observe(el);
      }
    }, []);

    const lastMessage = messages[messages.length - 1];
    const lastMessageContent =
      lastMessage && lastMessage.role === "assistant"
        ? extractMessageContent(lastMessage)
        : "";
    const lastAssistantHasNoContent =
      lastMessage?.role === "assistant" &&
      !lastMessageContent.trim() &&
      !hasMessageTextOrFileParts(lastMessage);
    const hasLiveReasoning = reasoningMessages.length > 0;
    const showStreamReasoningInLastAssistantRow =
      isLoading &&
      lastAssistantHasNoContent &&
      lastMessage != null &&
      extractReasoningStepMessages(lastMessage).length === 0 &&
      !warmupPending &&
      hasLiveReasoning;
    const showPendingErrorForEmptyAssistant =
      lastMessage?.role === "assistant" &&
      lastAssistantHasNoContent &&
      !isLoading;
    const showLoadingArea =
      isLoading &&
      (!lastMessage ||
        lastMessage.role !== "assistant" ||
        lastAssistantHasNoContent);
    const showReasoningLoaders =
      showLoadingArea &&
      hasLiveReasoning &&
      !warmupPending &&
      !showStreamReasoningInLastAssistantRow;
    const showPendingError = showPendingErrorForEmptyAssistant;
    const showLoadingIndicator =
      showLoadingArea &&
      !warmupPending &&
      !showReasoningLoaders &&
      !showPendingError;
    const loadingIndicatorLabel = undefined;

    const sections = groupMessagesIntoSection(messages);
    const showEmptyStateLoaders =
      sections.length === 0 && (showLoadingArea || warmupPending);

    const selectedChat = chats.find((c) => c.id === selectedChatId);
    const coworkerId =
      selectedChat?.coworker?.id ?? conversationCoworkerFallback?.id;
    const coworkerName =
      selectedChat?.coworker?.name ?? conversationCoworkerFallback?.name;
    const coworkerFromList = coworkerId
      ? coworkers.find((c) => c.id === coworkerId)
      : undefined;
    const coworkerImageUrl =
      selectedChat?.coworker?.avatar ??
      conversationCoworkerFallback?.avatar ??
      coworkerFromList?.avatar;
    const modelName = selectedChat?.model?.name;
    const modelId = selectedChat?.model?.id;

    const lastUserMessage = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if ((msg.role as string) === "user") {
          return msg;
        }
      }
      return null;
    })();
    const lastUserMessageText = lastUserMessage
      ? extractMessageContent(lastUserMessage).trim()
      : "";
    const lastUserMessageHasParts =
      lastUserMessage != null && hasMessageTextOrFileParts(lastUserMessage);
    const lastUserMessageHasContent =
      lastUserMessageText.length > 0 || lastUserMessageHasParts;

    const showUserTailRecoveryError =
      userTailRecoveryFailed &&
      lastMessage?.role === "user" &&
      lastUserMessageHasContent;
    const showPendingOrTailError =
      !warmupPending &&
      !coworkerResponseInProgress &&
      (showPendingError || showUserTailRecoveryError);
    const canResendPendingOrTail = Boolean(
      showPendingOrTailError &&
        onResendLastMessage &&
        lastUserMessageHasContent,
    );

    const pendingErrorMessage = t("pendingResponseFailed");
    const responseInProgressMessage = t("responseAlreadyInProgress");
    const warmupNoticeName =
      warmupCoworkerName?.trim() ||
      coworkerName?.trim() ||
      t("coworkerNameFallback");
    const warmupLoaderLabel =
      warmupMessagePhase === "thinking"
        ? t("coworkerWarmupThinking", { name: warmupNoticeName })
        : warmupMessagePhase === "slow"
          ? t("coworkerWarmupSlow")
          : t("coworkerWarmingUp", { name: warmupNoticeName });
    const warmupLoaderBlock = warmupPending && (
      <LoadingIndicator label={warmupLoaderLabel} />
    );
    const responseInProgressBlock = coworkerResponseInProgress &&
      !warmupPending &&
      !isLoading && (
        <div className="flex min-h-11 w-full items-start gap-3 px-4 py-1.5">
          <Avatar
            className={cn(
              "size-8 shrink-0 overflow-hidden rounded-full",
              modelId && "bg-white dark:bg-black",
            )}
          >
            <AssistantAvatarContent
              coworkerId={coworkerId ?? undefined}
              coworkerImageUrl={coworkerImageUrl}
              coworkerName={coworkerName}
              modelId={modelId ?? undefined}
              modelName={modelName}
            />
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              {responseInProgressMessage}
            </p>
          </div>
        </div>
      );
    const pendingOrTailErrorBlock = showPendingOrTailError && (
      <div className="flex min-h-11 w-full items-start gap-3 px-4 py-1.5">
        <Avatar
          className={cn(
            "size-8 shrink-0 overflow-hidden rounded-full",
            modelId && "bg-white dark:bg-black",
          )}
        >
          <AssistantAvatarContent
            coworkerId={coworkerId ?? undefined}
            coworkerImageUrl={coworkerImageUrl}
            coworkerName={coworkerName}
            modelId={modelId ?? undefined}
            modelName={modelName}
          />
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-muted-foreground text-sm">{pendingErrorMessage}</p>
          {canResendPendingOrTail && (
            <Button
              className="bg-foreground text-background hover:bg-foreground/90 w-fit"
              onClick={() => {
                if (lastUserMessage) onResendLastMessage?.(lastUserMessage);
              }}
              size="sm"
            >
              {t("resend")}
            </Button>
          )}
        </div>
      </div>
    );

    useEffect(() => {
      if (sections.length > 1) scrollToMax();
    }, [sections.length, scrollToMax]);

    function renderMessage(message: UIMessage, index: number) {
      const role = message.role as "user" | "assistant" | "system";
      const currentCreatedAt = getCreatedAtFromUiMessage(message);
      const previousCreatedAt =
        index > 0
          ? getLastDatedMessageCreatedAtBefore(messages, index)
          : undefined;
      const showDaySeparator =
        index === 0 ||
        (currentCreatedAt &&
          isDifferentDay(currentCreatedAt, previousCreatedAt));
      const content = extractMessageContent(message);
      const fileParts = getMessageFileParts(message);
      const isLastMessage = index === messages.length - 1;
      const reasoningFromParts =
        role === "assistant" ? extractReasoningStepMessages(message) : [];
      const showStreamOnlyThoughtBar =
        role === "assistant" &&
        isLastMessage &&
        reasoningFromParts.length === 0 &&
        hasLiveReasoning &&
        !warmupPending &&
        (isLoading || content.trim().length > 0);
      const storedThoughtTiming =
        role === "assistant" && isCoworker
          ? getThoughtTimingMsFromMessage(message)
          : { startedAtMs: null, endedAtMs: null };
      const hasStoredThoughtTiming =
        storedThoughtTiming.startedAtMs != null ||
        storedThoughtTiming.endedAtMs != null;
      const reasoningStartedAtForBar = hasStoredThoughtTiming
        ? storedThoughtTiming.startedAtMs
        : reasoningFromParts.length > 0 && !isLastMessage
          ? null
          : (reasoningStartedAt ?? null);
      const reasoningEndedAtForBar = hasStoredThoughtTiming
        ? storedThoughtTiming.endedAtMs
        : reasoningFromParts.length > 0 && !isLastMessage
          ? null
          : (reasoningEndedAt ?? null);
      const isStreaming = isLoading && isLastMessage && role === "assistant";
      if (
        role === "assistant" &&
        !content.trim() &&
        !isStreaming &&
        !isLastMessage
      ) {
        return null;
      }
      const hideEmptyAssistantWhileLoading =
        isLastMessage &&
        role === "assistant" &&
        !content.trim() &&
        isLoading &&
        (warmupPending || showReasoningLoaders || showLoadingIndicator) &&
        !showStreamOnlyThoughtBar;
      const hideEmptyAssistantShowError =
        isLastMessage &&
        role === "assistant" &&
        !content.trim() &&
        showPendingErrorForEmptyAssistant;
      const stableKeyForLastAssistant = isLastMessage && role === "assistant";
      const messageKey = stableKeyForLastAssistant
        ? `${selectedChatId ?? "no-chat"}-${index}-last-assistant-${content.trim().length}-${listRevision}`
        : `${selectedChatId ?? "no-chat"}-${index}-${message.id ?? ""}`;

      return (
        <div key={messageKey} data-message-role={role}>
          {showDaySeparator && currentCreatedAt && (
            <DaySeparator
              date={currentCreatedAt}
              formatDaySeparator={formatDaySeparator}
            />
          )}
          {!hideEmptyAssistantWhileLoading && !hideEmptyAssistantShowError && (
            <div className="mb-1">
              {(reasoningFromParts.length > 0 || showStreamOnlyThoughtBar) && (
                <ThoughtSummaryBar
                  reasoningMessages={
                    reasoningFromParts.length > 0
                      ? reasoningFromParts
                      : reasoningMessages
                  }
                  reasoningStartedAt={reasoningStartedAtForBar}
                  reasoningEndedAt={reasoningEndedAtForBar}
                />
              )}
              <ChatMessage
                role={role}
                content={content}
                fileParts={fileParts}
                userImageUrl={userImageUrl}
                userName={userName}
                createdAt={currentCreatedAt}
                coworkerName={coworkerName}
                coworkerId={coworkerId}
                coworkerImageUrl={coworkerImageUrl}
                modelName={modelName}
                modelId={modelId}
                isStreaming={isStreaming}
              />
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        ref={setWrapperRef}
        className="absolute inset-x-0 top-0 bottom-32 overflow-hidden"
      >
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ overflowAnchor: "none" }}
        >
          <div className="flex flex-col items-center pt-20 pb-40 md:pt-4">
            <div className="flex w-full max-w-4xl flex-col">
              {showEmptyStateLoaders && (
                <>
                  {showReasoningLoaders && (
                    <ReasoningLoaders
                      reasoningMessages={reasoningMessages}
                      selectedChatId={selectedChatId}
                      chats={chats}
                      coworkers={coworkers}
                    />
                  )}
                  {showLoadingIndicator && (
                    <LoadingIndicator label={loadingIndicatorLabel} />
                  )}
                  {warmupLoaderBlock}
                  {responseInProgressBlock}
                  {pendingOrTailErrorBlock}
                  <div
                    className="min-h-[160px] shrink-0"
                    aria-hidden
                    data-slot="scroll-spacer"
                  />
                </>
              )}
              {sections.map((section, sectionIndex) => {
                const isActiveNewSection =
                  sectionIndex > 0 && sectionIndex === sections.length - 1;
                const sectionHeight =
                  isActiveNewSection && contentHeight > 0
                    ? contentHeight
                    : undefined;
                const sectionStyle = sectionHeight
                  ? { height: `${sectionHeight}px` }
                  : undefined;
                const globalStart = sections
                  .slice(0, sectionIndex)
                  .reduce((sum, sec) => sum + sec.length, 0);

                return (
                  <div
                    key={`section-${sectionIndex}`}
                    style={sectionStyle}
                    className="flex flex-col justify-start pt-4"
                  >
                    {section.map((message, i) => {
                      return (
                        <Fragment key={`section-${sectionIndex}-msg-${i}`}>
                          {renderMessage(message, globalStart + i)}
                        </Fragment>
                      );
                    })}
                    {sectionIndex === sections.length - 1 && (
                      <>
                        {showReasoningLoaders && (
                          <ReasoningLoaders
                            reasoningMessages={reasoningMessages}
                            selectedChatId={selectedChatId}
                            chats={chats}
                            coworkers={coworkers}
                          />
                        )}
                        {showLoadingIndicator && (
                          <LoadingIndicator label={loadingIndicatorLabel} />
                        )}
                        {warmupLoaderBlock}
                        {responseInProgressBlock}
                        {pendingOrTailErrorBlock}
                        {showLoadingArea && (
                          <div
                            className="min-h-[160px] shrink-0"
                            aria-hidden
                            data-slot="scroll-spacer"
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <div className="min-h-px shrink-0" ref={endRef} />
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default MessageList;
