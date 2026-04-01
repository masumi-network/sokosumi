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

import { useScrollToBottom } from "@/app/chat/hooks/use-scroll-to-bottom";
import {
  formatDaySeparator,
  isDifferentDay,
} from "@/app/chat/utils/date-utils";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AssistantAvatarContent } from "./assistant-avatar-content";
import ChatMessage from "./chat-message";
import DaySeparator from "./day-separator";
import LoadingIndicator from "./loading-indicator";
import ReasoningLoaders from "./reasoning-loaders";
import ThoughtSummaryBar from "./thought-summary-bar";

export type MessageListHandle = Record<string, never>;

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

interface MessageListProps {
  messages: UIMessage[];
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
  userImageUrl: string;
  userName?: string;
  isLoading: boolean;
  isPollingForPendingResponse?: boolean;
  isRecovering?: boolean;
  isRecoveringPolling?: boolean;
  /** When true, show "connection lost" message instead of generic pending error */
  isRecoveryNotFound?: boolean;
  pendingResponseFailed?: boolean;
  hasPendingIdInMetadata?: boolean;
  conversationCoworkerFallback?: {
    id: string;
    name?: string;
    avatar?: string | null;
  } | null;
  reasoningMessages?: Array<{ id: string; message: string }>;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
  isCoworker?: boolean;
  onResendLastMessage?: (lastUserMessageText: string) => void;
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
      isPollingForPendingResponse = false,
      isRecovering = false,
      isRecoveringPolling = false,
      isRecoveryNotFound = false,
      pendingResponseFailed = false,
      hasPendingIdInMetadata = false,
      conversationCoworkerFallback = null,
      reasoningMessages = [],
      reasoningStartedAt,
      reasoningEndedAt,
      isCoworker = false,
      onResendLastMessage,
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

    useImperativeHandle(ref, () => ({}), []);

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

    const messagesWithTimestamps = messages.map((message) => {
      if ("createdAt" in message && message.createdAt) {
        return message;
      }
      return {
        ...message,
        createdAt: new Date(),
      };
    });

    const lastMessage =
      messagesWithTimestamps[messagesWithTimestamps.length - 1];
    const lastMessageContent =
      lastMessage && lastMessage.role === "assistant"
        ? extractMessageContent(lastMessage)
        : "";
    const lastAssistantHasNoContent =
      lastMessage?.role === "assistant" && !lastMessageContent.trim();
    const showPendingErrorForEmptyAssistant =
      hasPendingIdInMetadata &&
      lastMessage?.role === "assistant" &&
      lastAssistantHasNoContent &&
      !isLoading;
    const showLoadingArea =
      (isLoading || isPollingForPendingResponse || isRecovering) &&
      (!lastMessage ||
        lastMessage.role !== "assistant" ||
        lastAssistantHasNoContent);
    const showReasoningLoaders =
      isCoworker &&
      showLoadingArea &&
      reasoningMessages.length > 0 &&
      !isRecoveringPolling &&
      !isRecovering;
    const hasStreamingWithReasoning =
      isCoworker &&
      reasoningMessages.length > 0 &&
      lastMessage?.role === "assistant" &&
      lastMessageContent.trim().length > 0;
    const recoveryInFlight = isRecovering || isRecoveringPolling;
    const showPendingError =
      !recoveryInFlight &&
      (pendingResponseFailed || showPendingErrorForEmptyAssistant);
    const showLoadingIndicator =
      isRecovering ||
      (showLoadingArea && !showReasoningLoaders && !showPendingError);
    const loadingIndicatorLabel = undefined;

    const sections = groupMessagesIntoSection(messagesWithTimestamps);

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

    const lastUserMessageText = (() => {
      for (let i = messagesWithTimestamps.length - 1; i >= 0; i--) {
        const msg = messagesWithTimestamps[i];
        if ((msg.role as string) === "user") {
          const text = extractMessageContent(msg).trim();
          if (text) return text;
          return "";
        }
      }
      return "";
    })();

    const canResend = Boolean(
      showPendingError && onResendLastMessage && lastUserMessageText,
    );

    const pendingErrorMessage = isRecoveryNotFound
      ? t("noResponseConnectionLost")
      : t("pendingResponseFailed");
    const pendingErrorBlock = showPendingError && (
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
          {canResend && (
            <Button
              className="bg-foreground text-background hover:bg-foreground/90 w-fit"
              onClick={() => onResendLastMessage?.(lastUserMessageText)}
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
      let currentCreatedAt: Date | undefined;
      if ("createdAt" in message) {
        const createdAtValue = message.createdAt;
        if (createdAtValue instanceof Date) {
          currentCreatedAt = createdAtValue;
        } else if (
          typeof createdAtValue === "string" ||
          typeof createdAtValue === "number"
        ) {
          currentCreatedAt = new Date(createdAtValue);
        }
      }
      let previousCreatedAt: Date | undefined;
      if (index > 0) {
        const prevMessage = messagesWithTimestamps[index - 1];
        if ("createdAt" in prevMessage) {
          const createdAtValue = prevMessage.createdAt;
          if (createdAtValue instanceof Date) {
            previousCreatedAt = createdAtValue;
          } else if (
            typeof createdAtValue === "string" ||
            typeof createdAtValue === "number"
          ) {
            previousCreatedAt = new Date(createdAtValue);
          }
        }
      }
      const showDaySeparator =
        index === 0 ||
        (currentCreatedAt &&
          isDifferentDay(currentCreatedAt, previousCreatedAt));
      const content = extractMessageContent(message);
      let createdAt: Date | undefined;
      if ("createdAt" in message) {
        const createdAtValue = message.createdAt;
        if (createdAtValue instanceof Date) {
          createdAt = createdAtValue;
        } else if (
          typeof createdAtValue === "string" ||
          typeof createdAtValue === "number"
        ) {
          createdAt = new Date(createdAtValue);
        }
      }
      const isLastMessage = index === messagesWithTimestamps.length - 1;
      const isStreaming = isLoading && isLastMessage && role === "assistant";
      const hideEmptyAssistantWhileLoading =
        isLastMessage &&
        role === "assistant" &&
        !content.trim() &&
        isLoading &&
        (showReasoningLoaders || showLoadingIndicator);
      const hideEmptyAssistantShowError =
        isLastMessage &&
        role === "assistant" &&
        !content.trim() &&
        showPendingErrorForEmptyAssistant;
      const stableKeyForLastAssistant = isLastMessage && role === "assistant";
      const messageKey = stableKeyForLastAssistant
        ? `${selectedChatId ?? "no-chat"}-${index}-last-assistant`
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
              <ChatMessage
                role={role}
                content={content}
                userImageUrl={userImageUrl}
                userName={userName}
                createdAt={createdAt}
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
        className="absolute inset-x-0 top-0 bottom-[8rem] overflow-hidden"
      >
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ overflowAnchor: "none" }}
        >
          <div className="flex flex-col items-center pt-20 pb-40 md:pt-4">
            <div className="flex w-full max-w-4xl flex-col">
              {sections.length === 0 &&
                (showLoadingArea || pendingResponseFailed || isRecovering) && (
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
                    {pendingErrorBlock}
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
                      const isLastInSection = i === section.length - 1;
                      const role = message.role as string;
                      const showThoughtBar =
                        sectionIndex === sections.length - 1 &&
                        isLastInSection &&
                        role === "assistant" &&
                        hasStreamingWithReasoning;
                      return (
                        <Fragment key={`section-${sectionIndex}-msg-${i}`}>
                          {showThoughtBar && (
                            <ThoughtSummaryBar
                              reasoningEndedAt={reasoningEndedAt ?? null}
                              reasoningMessages={reasoningMessages}
                              reasoningStartedAt={reasoningStartedAt ?? null}
                            />
                          )}
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
                        {pendingErrorBlock}
                        {(showLoadingArea || pendingResponseFailed) && (
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
