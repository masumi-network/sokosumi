"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef } from "react";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import { getConversationItems } from "@/lib/actions/conversation/core-api-actions";

interface SetMessagesForConversation {
  (convId: string, messages: UIMessage[]): void;
}

interface UseChatMessagesProps {
  selectedChatId: string | null;
  selectedConversation: {
    id: string;
    items?: Array<{
      id: string;
      role: string;
      content: Array<{ type: string; text?: string }> | string;
      createdAt: number;
    }>;
    metadata?: Record<string, unknown> | null;
  } | null;
  skipLoadWhenPendingId?: boolean;
  setMessagesForConversation: SetMessagesForConversation;
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
  skipLoadWhenPendingId,
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
      const meta = (selectedConversation?.metadata ?? {}) as Record<
        string,
        unknown
      >;
      const hasPendingResponseId =
        skipLoadWhenPendingId === true ||
        (selectedConversation?.id === currentSelectedChatId &&
          typeof meta.pending_responses_api_response_id === "string" &&
          meta.pending_responses_api_response_id.length > 0);
      if (hasPendingResponseId) {
        return;
      }
      const hasSyncItems =
        selectedConversation?.id === currentSelectedChatId &&
        Array.isArray(selectedConversation.items);

      // Clear any existing retry timeout from previous effect run
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      if (hasSyncItems && selectedConversation.items) {
        const items = selectedConversation.items;
        previousChatIdRef.current = currentSelectedChatId;
        if (items.length > 0) {
          const dbMessages = convertItemsToMessages(items);
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
                items: Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  createdAt: number;
                }>;
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

          const rawItemsResult: unknown = await getConversationItems({
            conversationId: currentSelectedChatId,
            limit: 100,
          });

          const resultAny = rawItemsResult as SerializedResult;
          let items: Array<{
            id: string;
            role: string;
            content: Array<{ type: string; text?: string }> | string;
            createdAt: number;
          }> | null = null;

          if (
            resultAny &&
            "ok" in resultAny &&
            resultAny.ok === true &&
            "data" in resultAny &&
            resultAny.data &&
            typeof resultAny.data === "object" &&
            "items" in resultAny.data
          ) {
            items = resultAny.data.items;
          } else if (
            resultAny &&
            "isOk" in resultAny &&
            typeof resultAny.isOk === "function"
          ) {
            if (resultAny.isOk() && "value" in resultAny) {
              const value = resultAny.value as {
                items: Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  createdAt: number;
                }>;
              };
              items = value.items;
            }
          }

          if (items && items.length > 0) {
            const dbMessages = convertItemsToMessages(items);
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
                  const retryResult: unknown = await getConversationItems({
                    conversationId: currentSelectedChatId,
                    limit: 100,
                  });
                  const retryResultAny = retryResult as SerializedResult;
                  let retryItems: Array<{
                    id: string;
                    role: string;
                    content: Array<{ type: string; text?: string }> | string;
                    createdAt: number;
                  }> | null = null;

                  if (
                    retryResultAny &&
                    "ok" in retryResultAny &&
                    retryResultAny.ok === true &&
                    "data" in retryResultAny &&
                    retryResultAny.data &&
                    typeof retryResultAny.data === "object" &&
                    "items" in retryResultAny.data
                  ) {
                    retryItems = retryResultAny.data.items;
                  } else if (
                    retryResultAny &&
                    "isOk" in retryResultAny &&
                    typeof retryResultAny.isOk === "function"
                  ) {
                    if (retryResultAny.isOk() && "value" in retryResultAny) {
                      const value = retryResultAny.value as {
                        items: Array<{
                          id: string;
                          role: string;
                          content:
                            | Array<{ type: string; text?: string }>
                            | string;
                          createdAt: number;
                        }>;
                      };
                      retryItems = value.items;
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
    skipLoadWhenPendingId,
    selectedConversation?.items,
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
      Array.isArray(selectedConversation.items) &&
      selectedConversation.items.length > 0
    ) {
      if (streamingConversationIdsRef?.current.has(selectedChatId)) {
        return;
      }
      const currentMessages = chatMessagesRef.current.get(selectedChatId);
      if (currentMessages && currentMessages.length > 0) {
        return;
      }

      const dbMessages = convertItemsToMessages(selectedConversation.items);
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
