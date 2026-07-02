"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef } from "react";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import {
  type ConversationWithMessages,
  getConversationMessages,
} from "@/lib/actions/conversation/core-api-actions";
import type { ConversationMessage } from "@/lib/clients/generated/core/types.gen";

interface UseChatMessagesProps {
  selectedChatId: string | null;
  selectedConversation: ConversationWithMessages | null;
  setMessagesForConversation: (convId: string, messages: UIMessage[]) => void;
  previousChatIdRef: React.MutableRefObject<string | null>;
  messagesChatIdRef: React.MutableRefObject<string | null>;
  chatMessagesRef: React.MutableRefObject<Map<string, unknown[]>>;
  streamingConversationIdsRef?: React.MutableRefObject<Set<string>>;
  welcomeCreationInFlightRef?: React.MutableRefObject<boolean>;
  pendingUrlConversationIdRef?: React.MutableRefObject<string | null>;
}

type SerializedConversationMessagesResult =
  | {
      ok: true;
      data: {
        messages: ConversationMessage[];
        pagination: {
          cursor: string | null;
          limit: number;
          total: number;
          nextCursor: string | null;
        } | null;
      };
    }
  | { ok: false; error: unknown }
  | { isOk: () => boolean; value?: unknown };

function readMessagesFromResult(
  rawItemsResult: unknown,
): ConversationMessage[] | null {
  const resultAny = rawItemsResult as SerializedConversationMessagesResult;

  if (
    resultAny &&
    "ok" in resultAny &&
    resultAny.ok === true &&
    "data" in resultAny &&
    resultAny.data &&
    typeof resultAny.data === "object" &&
    "messages" in resultAny.data
  ) {
    return resultAny.data.messages;
  }

  if (
    resultAny &&
    "isOk" in resultAny &&
    typeof resultAny.isOk === "function" &&
    resultAny.isOk() &&
    "value" in resultAny
  ) {
    const value = resultAny.value as {
      messages: ConversationMessage[];
    };
    return value.messages;
  }

  return null;
}

function endsWithUserMessage(messages: ConversationMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "user";
}

/**
 * Hook to handle message loading from database, caching, and conversion
 */
export function useChatMessages({
  selectedChatId,
  selectedConversation,
  setMessagesForConversation,
  previousChatIdRef,
  messagesChatIdRef,
  chatMessagesRef,
  streamingConversationIdsRef,
  welcomeCreationInFlightRef,
  pendingUrlConversationIdRef,
}: UseChatMessagesProps) {
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;
      if (streamingConversationIdsRef?.current.has(currentSelectedChatId)) {
        return;
      }
      const hasLoadedConversationMessages =
        selectedConversation?.id === currentSelectedChatId &&
        Array.isArray(selectedConversation.messages) &&
        selectedConversation.messages.length > 0;

      // Clear any existing retry timeout from previous effect run
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      const selectedConversationMessages =
        hasLoadedConversationMessages && selectedConversation.messages
          ? selectedConversation.messages
          : null;

      if (selectedConversationMessages) {
        previousChatIdRef.current = currentSelectedChatId;
        const dbMessages = convertItemsToMessages(selectedConversationMessages);
        messagesChatIdRef.current = currentSelectedChatId;
        setMessagesForConversation(currentSelectedChatId, dbMessages);
        chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
      } else {
        previousChatIdRef.current = currentSelectedChatId;
        const cachedMessages = chatMessagesRef.current.get(
          currentSelectedChatId,
        );
        const hasCachedMessages =
          cachedMessages !== undefined && cachedMessages.length > 0;
        const isDeferredLoad =
          welcomeCreationInFlightRef?.current ||
          pendingUrlConversationIdRef?.current === currentSelectedChatId;

        if (hasCachedMessages) {
          messagesChatIdRef.current = currentSelectedChatId;
          setMessagesForConversation(
            currentSelectedChatId,
            cachedMessages as UIMessage[],
          );
        } else if (isDeferredLoad) {
          messagesChatIdRef.current = currentSelectedChatId;
        } else {
          messagesChatIdRef.current = null;
          setMessagesForConversation(currentSelectedChatId, []);
        }
      }

      const shouldForceRefreshOnLoad =
        selectedConversationMessages !== null ||
        (chatMessagesRef.current.get(currentSelectedChatId)?.length ?? 0) > 0;

      const loadMessagesFromDB = async (
        options: { forceRefresh?: boolean; retryAttempt?: number } = {},
      ) => {
        const { forceRefresh = false, retryAttempt = 0 } = options;
        const isDeferredLoad =
          welcomeCreationInFlightRef?.current ||
          pendingUrlConversationIdRef?.current === currentSelectedChatId;
        if (isDeferredLoad) {
          if (previousChatIdRef.current !== currentSelectedChatId) {
            return;
          }
          retryTimeoutRef.current = setTimeout(() => {
            void loadMessagesFromDB({
              forceRefresh: true,
              retryAttempt: retryAttempt + 1,
            });
          }, 300);
          return;
        }
        // Use ref-based check instead of closure values to detect chat changes
        if (
          previousChatIdRef.current !== currentSelectedChatId ||
          (messagesChatIdRef.current !== null && !forceRefresh)
        ) {
          return;
        }

        try {
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (!forceRefresh && cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessagesForConversation(
              currentSelectedChatId,
              cachedMessages as UIMessage[],
            );
          }

          const rawItemsResult: unknown = await getConversationMessages({
            conversationId: currentSelectedChatId,
            limit: 100,
          });

          const conversationMessages = readMessagesFromResult(rawItemsResult);

          if (conversationMessages && conversationMessages.length > 0) {
            const dbMessages = convertItemsToMessages(conversationMessages);
            messagesChatIdRef.current = currentSelectedChatId;
            setMessagesForConversation(currentSelectedChatId, dbMessages);
            chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
            if (endsWithUserMessage(conversationMessages) && retryAttempt < 1) {
              retryTimeoutRef.current = setTimeout(() => {
                void loadMessagesFromDB({
                  forceRefresh: true,
                  retryAttempt: retryAttempt + 1,
                });
              }, 1000);
            }
          } else if (!cachedMessages || forceRefresh) {
            // Store retry timeout ID in ref so it can be cleared by cleanup
            retryTimeoutRef.current = setTimeout(async () => {
              // Use ref-based check to ensure we're still on the same chat
              if (
                previousChatIdRef.current === currentSelectedChatId &&
                (messagesChatIdRef.current === null || forceRefresh)
              ) {
                try {
                  const retryResult: unknown = await getConversationMessages({
                    conversationId: currentSelectedChatId,
                    limit: 100,
                  });
                  const retryItems = readMessagesFromResult(retryResult);

                  // Double-check refs before updating state
                  if (
                    previousChatIdRef.current === currentSelectedChatId &&
                    (messagesChatIdRef.current === null || forceRefresh)
                  ) {
                    if (retryItems && retryItems.length > 0) {
                      const retryMessages = convertItemsToMessages(retryItems);
                      messagesChatIdRef.current = currentSelectedChatId;
                      setMessagesForConversation(
                        currentSelectedChatId,
                        retryMessages,
                      );
                      chatMessagesRef.current.set(
                        currentSelectedChatId,
                        retryMessages,
                      );
                    } else {
                      messagesChatIdRef.current = currentSelectedChatId;
                      setMessagesForConversation(currentSelectedChatId, []);
                    }
                  }
                } catch (error) {
                  console.error(
                    "Failed to reload messages from database:",
                    error,
                  );
                  // Only update if still on the same chat
                  if (
                    previousChatIdRef.current === currentSelectedChatId &&
                    messagesChatIdRef.current === null
                  ) {
                    messagesChatIdRef.current = currentSelectedChatId;
                    setMessagesForConversation(currentSelectedChatId, []);
                  }
                }
              }
            }, 500);
          }
        } catch (error) {
          console.error("Failed to load messages from database:", error);
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessagesForConversation(
              currentSelectedChatId,
              cachedMessages as UIMessage[],
            );
          } else {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessagesForConversation(currentSelectedChatId, []);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        void loadMessagesFromDB({
          forceRefresh: shouldForceRefreshOnLoad,
        });
      }, 0);

      return () => {
        clearTimeout(timeoutId);
        // Clear the retry timeout if it exists
        if (retryTimeoutRef.current !== null) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
      };
    } else {
      previousChatIdRef.current = null;
      messagesChatIdRef.current = null;
    }
  }, [
    selectedChatId,
    selectedConversation,
    selectedConversation?.messages,
    setMessagesForConversation,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
    retryTimeoutRef,
    streamingConversationIdsRef,
    welcomeCreationInFlightRef,
    pendingUrlConversationIdRef,
  ]);

  useEffect(() => {
    if (
      selectedChatId &&
      selectedConversation?.id === selectedChatId &&
      Array.isArray(selectedConversation.messages) &&
      selectedConversation.messages.length > 0
    ) {
      if (streamingConversationIdsRef?.current.has(selectedChatId)) {
        return;
      }
      const currentMessages = chatMessagesRef.current.get(selectedChatId);
      if (currentMessages && currentMessages.length > 0) {
        return;
      }

      const dbMessages = convertItemsToMessages(selectedConversation.messages);
      messagesChatIdRef.current = selectedChatId;
      setMessagesForConversation(selectedChatId, dbMessages);
      chatMessagesRef.current.set(selectedChatId, dbMessages);

      previousChatIdRef.current = selectedChatId;
    }
  }, [
    selectedConversation,
    selectedChatId,
    setMessagesForConversation,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
    streamingConversationIdsRef,
  ]);

  const cacheMessages = useCallback(
    (chatId: string, messages: UIMessage[]) => {
      if (
        chatId &&
        previousChatIdRef.current === chatId &&
        messagesChatIdRef.current === chatId &&
        messages.length > 0
      ) {
        chatMessagesRef.current.set(chatId, messages);
      }
    },
    [previousChatIdRef, messagesChatIdRef, chatMessagesRef],
  );

  const clearMessages = useCallback(
    (chatId: string) => {
      chatMessagesRef.current.delete(chatId);
    },
    [chatMessagesRef],
  );

  return {
    chatMessagesRef,
    messagesChatIdRef,
    cacheMessages,
    clearMessages,
  };
}
