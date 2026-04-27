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
}: UseChatMessagesProps) {
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;
      if (streamingConversationIdsRef?.current.has(currentSelectedChatId)) {
        return;
      }
      const hasSyncMessages =
        selectedConversation?.id === currentSelectedChatId &&
        Array.isArray(selectedConversation.messages);

      // Clear any existing retry timeout from previous effect run
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      if (hasSyncMessages && selectedConversation.messages) {
        const conversationMessages = selectedConversation.messages;
        previousChatIdRef.current = currentSelectedChatId;
        if (conversationMessages.length > 0) {
          const dbMessages = convertItemsToMessages(conversationMessages);
          messagesChatIdRef.current = currentSelectedChatId;
          setMessagesForConversation(currentSelectedChatId, dbMessages);
          chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
        } else {
          messagesChatIdRef.current = currentSelectedChatId;
          setMessagesForConversation(currentSelectedChatId, []);
        }
        return;
      }

      messagesChatIdRef.current = null;
      setMessagesForConversation(currentSelectedChatId, []);
      previousChatIdRef.current = currentSelectedChatId;

      const loadMessagesFromDB = async () => {
        // Use ref-based check instead of closure values to detect chat changes
        if (
          previousChatIdRef.current !== currentSelectedChatId ||
          messagesChatIdRef.current !== null
        ) {
          return;
        }

        type SerializedResult =
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

        try {
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
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

          const resultAny = rawItemsResult as SerializedResult;
          let conversationMessages: ConversationMessage[] | null = null;

          if (
            resultAny &&
            "ok" in resultAny &&
            resultAny.ok === true &&
            "data" in resultAny &&
            resultAny.data &&
            typeof resultAny.data === "object" &&
            "messages" in resultAny.data
          ) {
            conversationMessages = resultAny.data.messages;
          } else if (
            resultAny &&
            "isOk" in resultAny &&
            typeof resultAny.isOk === "function"
          ) {
            if (resultAny.isOk() && "value" in resultAny) {
              const value = resultAny.value as {
                messages: ConversationMessage[];
              };
              conversationMessages = value.messages;
            }
          }

          if (conversationMessages && conversationMessages.length > 0) {
            const dbMessages = convertItemsToMessages(conversationMessages);
            messagesChatIdRef.current = currentSelectedChatId;
            setMessagesForConversation(currentSelectedChatId, dbMessages);
            chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
          } else if (!cachedMessages) {
            // Store retry timeout ID in ref so it can be cleared by cleanup
            retryTimeoutRef.current = setTimeout(async () => {
              // Use ref-based check to ensure we're still on the same chat
              if (
                previousChatIdRef.current === currentSelectedChatId &&
                messagesChatIdRef.current === null
              ) {
                try {
                  const retryResult: unknown = await getConversationMessages({
                    conversationId: currentSelectedChatId,
                    limit: 100,
                  });
                  const retryResultAny = retryResult as SerializedResult;
                  let retryItems: ConversationMessage[] | null = null;

                  if (
                    retryResultAny &&
                    "ok" in retryResultAny &&
                    retryResultAny.ok === true &&
                    "data" in retryResultAny &&
                    retryResultAny.data &&
                    typeof retryResultAny.data === "object" &&
                    "messages" in retryResultAny.data
                  ) {
                    retryItems = retryResultAny.data.messages;
                  } else if (
                    retryResultAny &&
                    "isOk" in retryResultAny &&
                    typeof retryResultAny.isOk === "function"
                  ) {
                    if (retryResultAny.isOk() && "value" in retryResultAny) {
                      const value = retryResultAny.value as {
                        messages: ConversationMessage[];
                      };
                      retryItems = value.messages;
                    }
                  }

                  // Double-check refs before updating state
                  if (
                    previousChatIdRef.current === currentSelectedChatId &&
                    messagesChatIdRef.current === null
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
        void loadMessagesFromDB();
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
