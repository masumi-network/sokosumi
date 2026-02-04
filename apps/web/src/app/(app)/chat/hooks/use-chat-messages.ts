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
  // Load messages from database when switching chats
  useEffect(() => {
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;

      // Clear messages immediately and mark as belonging to no chat
      messagesChatIdRef.current = null;
      setMessages([]);

      // Set ref AFTER clearing messages to prevent preview updates with wrong messages
      previousChatIdRef.current = currentSelectedChatId;

      // Fetch messages from database (source of truth)
      const loadMessagesFromDB = async () => {
        // Only proceed if we're still on the same chat (user didn't switch again)
        if (selectedChatId !== currentSelectedChatId) {
          return;
        }

        // Type for parsing serialized Result from server action
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
          // Check in-memory cache first (for performance)
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(cachedMessages as Parameters<typeof setMessages>[0]);
          }

          // Always fetch from DB to ensure we have the latest data
          // This ensures DB is the source of truth
          const rawItemsResult: unknown = await getConversationItems({
            conversationId: currentSelectedChatId,
          });

          // Parse the serialized Result from server action
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
            // It's a proper neverthrow Result (shouldn't happen after serialization, but handle it)
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
            // Update cache with fresh data from DB
            chatMessagesRef.current.set(currentSelectedChatId, dbMessages);

            // Extract last assistant message and update chat preview
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
            // No cache and DB fetch returned empty - check if we should wait a bit
            // for newly created conversations that might have messages being saved
            // Wait a short time and reload to catch messages that were just saved
            setTimeout(async () => {
              // Only reload if we're still on the same chat
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
                    // Still no messages - start fresh
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
            }, 500); // Wait 500ms for messages to be saved to DB
          }
        } catch (error) {
          console.error("Failed to load messages from database:", error);
          // Fallback to cache if available
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

      // Small delay to ensure messages are cleared before loading
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

  // Also reload messages when selectedConversation updates (in case it loads after selectedChatId is set)
  useEffect(() => {
    if (
      selectedChatId &&
      selectedConversation?.id === selectedChatId &&
      selectedConversation.items &&
      selectedConversation.items.length > 0
    ) {
      // Check if we already have messages loaded
      const currentMessages = chatMessagesRef.current.get(selectedChatId);
      if (currentMessages && currentMessages.length > 0) {
        // Already loaded, skip
        return;
      }

      // Convert ConversationItem[] to UIMessage format
      const dbMessages = convertItemsToMessages(selectedConversation.items);
      messagesChatIdRef.current = selectedChatId; // Track that messages belong to this chat
      setMessages(dbMessages as unknown as Parameters<typeof setMessages>[0]);
      // Update cache with data from DB
      chatMessagesRef.current.set(selectedChatId, dbMessages);

      // Extract last assistant message and update chat preview
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

  // Update in-memory cache whenever messages change for the current chat
  // Note: Messages are persisted to DB via addConversationItem, so we only cache here
  const cacheMessages = useCallback(
    (chatId: string, messages: UIMessage[]) => {
      if (
        chatId &&
        previousChatIdRef.current === chatId &&
        messagesChatIdRef.current === chatId &&
        messages.length > 0
      ) {
        // Update cache for performance (DB is source of truth)
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
