"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect } from "react";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import { getConversationItems } from "@/lib/actions/conversation/core-api-actions";

interface UseChatMessagesProps {
  selectedChatId: string | null;
  selectedConversation: {
    id: string;
    items?: Array<{
      id: string;
      role: string;
      content: Array<{ type: string; text?: string }> | string;
      created_at: number;
    }>;
  } | null;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  previousChatIdRef: React.MutableRefObject<string | null>;
  messagesChatIdRef: React.MutableRefObject<string | null>;
  chatMessagesRef: React.MutableRefObject<Map<string, unknown[]>>;
  updateChatPreview: (
    chatId: string,
    content: string,
    isFirstMessage?: boolean,
  ) => void;
}

/**
 * Hook to handle message loading from database, caching, and conversion
 */
export function useChatMessages({
  selectedChatId,
  selectedConversation,
  setMessages,
  previousChatIdRef,
  messagesChatIdRef,
  chatMessagesRef,
  updateChatPreview,
}: UseChatMessagesProps) {
  useEffect(() => {
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;

      messagesChatIdRef.current = null;
      setMessages([]);
      previousChatIdRef.current = currentSelectedChatId;

      const loadMessagesFromDB = async () => {
        if (selectedChatId !== currentSelectedChatId) {
          return;
        }

        type SerializedResult =
          | {
              ok: true;
              data: Array<{
                id: string;
                role: string;
                content: Array<{ type: string; text?: string }> | string;
                created_at: number;
              }>;
            }
          | { ok: false; error: unknown }
          | { isOk: () => boolean; value?: unknown };

        try {
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(cachedMessages as Parameters<typeof setMessages>[0]);
          }

          const rawItemsResult: unknown = await getConversationItems({
            conversationId: currentSelectedChatId,
          });

          const resultAny = rawItemsResult as SerializedResult;
          let items: Array<{
            id: string;
            role: string;
            content: Array<{ type: string; text?: string }> | string;
            created_at: number;
          }> | null = null;

          if (
            resultAny &&
            "ok" in resultAny &&
            resultAny.ok === true &&
            "data" in resultAny
          ) {
            items = resultAny.data;
          } else if (
            resultAny &&
            "isOk" in resultAny &&
            typeof resultAny.isOk === "function"
          ) {
            if (resultAny.isOk() && "value" in resultAny) {
              items = resultAny.value as Array<{
                id: string;
                role: string;
                content: Array<{ type: string; text?: string }> | string;
                created_at: number;
              }>;
            }
          }

          if (items && items.length > 0) {
            const dbMessages = convertItemsToMessages(items);
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(
              dbMessages as unknown as Parameters<typeof setMessages>[0],
            );
            chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
            const lastAssistantItem = items
              .slice()
              .reverse()
              .find((item) => item.role === "assistant");
            if (lastAssistantItem) {
              const lastMessageContent =
                typeof lastAssistantItem.content === "string"
                  ? lastAssistantItem.content
                  : lastAssistantItem.content.map((c) => c.text || "").join("");
              if (lastMessageContent) {
                updateChatPreview(
                  currentSelectedChatId,
                  lastMessageContent,
                  false,
                );
              }
            }
          } else if (!cachedMessages) {
            setTimeout(async () => {
              if (selectedChatId === currentSelectedChatId) {
                try {
                  const retryResult: unknown = await getConversationItems({
                    conversationId: currentSelectedChatId,
                  });
                  const retryResultAny = retryResult as SerializedResult;
                  let retryItems: Array<{
                    id: string;
                    role: string;
                    content: Array<{ type: string; text?: string }> | string;
                    created_at: number;
                  }> | null = null;

                  if (
                    retryResultAny &&
                    "ok" in retryResultAny &&
                    retryResultAny.ok === true &&
                    "data" in retryResultAny
                  ) {
                    retryItems = retryResultAny.data;
                  } else if (
                    retryResultAny &&
                    "isOk" in retryResultAny &&
                    typeof retryResultAny.isOk === "function"
                  ) {
                    if (retryResultAny.isOk() && "value" in retryResultAny) {
                      retryItems = retryResultAny.value as Array<{
                        id: string;
                        role: string;
                        content:
                          | Array<{ type: string; text?: string }>
                          | string;
                        created_at: number;
                      }>;
                    }
                  }

                  if (retryItems && retryItems.length > 0) {
                    const retryMessages = convertItemsToMessages(retryItems);
                    messagesChatIdRef.current = currentSelectedChatId;
                    setMessages(
                      retryMessages as unknown as Parameters<
                        typeof setMessages
                      >[0],
                    );
                    chatMessagesRef.current.set(
                      currentSelectedChatId,
                      retryMessages,
                    );
                  } else {
                    messagesChatIdRef.current = currentSelectedChatId;
                    setMessages([]);
                  }
                } catch (error) {
                  console.error(
                    "Failed to reload messages from database:",
                    error,
                  );
                  messagesChatIdRef.current = currentSelectedChatId;
                  setMessages([]);
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
            setMessages(cachedMessages as Parameters<typeof setMessages>[0]);
          } else {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages([]);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        void loadMessagesFromDB();
      }, 0);

      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      previousChatIdRef.current = null;
      messagesChatIdRef.current = null;
      setMessages([]);
    }
  }, [selectedChatId, setMessages, previousChatIdRef, updateChatPreview]);

  useEffect(() => {
    if (
      selectedChatId &&
      selectedConversation?.id === selectedChatId &&
      selectedConversation.items &&
      selectedConversation.items.length > 0
    ) {
      const currentMessages = chatMessagesRef.current.get(selectedChatId);
      if (currentMessages && currentMessages.length > 0) {
        return;
      }

      const dbMessages = convertItemsToMessages(selectedConversation.items);
      messagesChatIdRef.current = selectedChatId;
      setMessages(dbMessages as unknown as Parameters<typeof setMessages>[0]);
      chatMessagesRef.current.set(selectedChatId, dbMessages);
      const lastAssistantItem = selectedConversation.items
        .slice()
        .reverse()
        .find((item) => item.role === "assistant");
      if (lastAssistantItem) {
        const lastMessageContent =
          typeof lastAssistantItem.content === "string"
            ? lastAssistantItem.content
            : lastAssistantItem.content.map((c) => c.text || "").join("");
        if (lastMessageContent) {
          updateChatPreview(selectedChatId, lastMessageContent, false);
        }
      }

      previousChatIdRef.current = selectedChatId;
    }
  }, [
    selectedConversation,
    selectedChatId,
    setMessages,
    previousChatIdRef,
    updateChatPreview,
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
    [previousChatIdRef],
  );

  const clearMessages = useCallback((chatId: string) => {
    chatMessagesRef.current.delete(chatId);
  }, []);

  return {
    chatMessagesRef,
    messagesChatIdRef,
    cacheMessages,
    clearMessages,
  };
}
