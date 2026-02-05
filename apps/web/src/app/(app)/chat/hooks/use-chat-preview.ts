"use client";

import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";

import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat } from "@/app/chat/utils/types";
import { getConversationItems } from "@/lib/actions/conversation/core-api-actions";

interface UseChatPreviewProps {
  conversations: Array<{ id: string }>;
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  selectedChatId: string | null;
  messages: UIMessage[];
  previousChatIdRef: React.MutableRefObject<string | null>;
  messagesChatIdRef: React.MutableRefObject<string | null>;
  chatMessagesRef: React.MutableRefObject<Map<string, unknown[]>>;
}

/**
 * Hook to handle chat preview updates with last assistant message
 */
export function useChatPreview({
  conversations,
  chats,
  setChats,
  selectedChatId,
  messages,
  previousChatIdRef,
  messagesChatIdRef,
  chatMessagesRef,
}: UseChatPreviewProps) {
  const t = useTranslations("App.Chat.Chat");
  const fetchedPreviewConversationIds = useRef<Set<string>>(new Set());

  const updateChatPreview = useCallback(
    (chatId: string, content: string, isFirstMessage = false) => {
      if (!content || !content.trim()) {
        return;
      }

      const now = new Date();
      setChats((prev) => {
        return prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              ...(isFirstMessage && {
                title: content.slice(0, 50) || t("newChat"),
              }),
              lastMessage: content,
              lastMessageTime: now,
              updatedAt: now,
              status: "active",
            };
          }
          return chat;
        });
      });
    },
    [setChats, t],
  );

  useEffect(() => {
    if (!selectedChatId || messages.length === 0) {
      return;
    }

    if (previousChatIdRef.current !== selectedChatId) {
      return;
    }

    if (messagesChatIdRef.current !== selectedChatId) {
      return;
    }

    if (!chatMessagesRef.current.has(selectedChatId)) {
      return;
    }
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === "assistant");

    if (lastAssistantMessage) {
      const content = extractMessageContent(lastAssistantMessage);
      if (content) {
        // Check if this content is different from what's currently stored
        const currentChat = chats.find((c) => c.id === selectedChatId);
        if (!currentChat || currentChat.lastMessage !== content) {
          const isFirstAssistantMessage =
            messages.filter((m) => m.role === "assistant").length === 1;
          // Use requestAnimationFrame to batch the state update
          requestAnimationFrame(() => {
            updateChatPreview(selectedChatId, content, isFirstAssistantMessage);
          });
        }
      }
    }
  }, [
    messages,
    selectedChatId,
    chats,
    updateChatPreview,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
  ]);

  // Fetch items for conversations to populate previews when conversations are loaded
  useEffect(() => {
    if (conversations.length === 0) {
      return;
    }

    // Fetch items for all conversations that haven't been fetched yet
    // This runs when conversations are loaded to populate previews automatically
    conversations.forEach((conv) => {
      // Skip if we've already fetched items for this conversation
      if (fetchedPreviewConversationIds.current.has(conv.id)) {
        return;
      }

      // Mark as fetching to avoid duplicate requests
      fetchedPreviewConversationIds.current.add(conv.id);

      // Fetch items for this conversation to populate preview
      void getConversationItems({ conversationId: conv.id })
        .then((rawResult: unknown) => {
          // Parse the serialized Result from server action
          type SerializedResult =
            | {
                ok: true;
                data: Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  createdAt: number;
                }>;
              }
            | { ok: false; error: unknown }
            | { isOk: () => boolean; value?: unknown };
          const resultAny = rawResult as SerializedResult;
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
                createdAt: number;
              }>;
            }
          }

          if (items && items.length > 0) {
            // Find the last assistant message
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
                updateChatPreview(conv.id, lastMessageContent, false);
              }
            }
          }
        })
        .catch((error) => {
          // If fetch fails, remove from fetched set so we can retry later
          fetchedPreviewConversationIds.current.delete(conv.id);
          console.error(
            `Failed to fetch items for conversation ${conv.id}:`,
            error,
          );
        });
    });
    // Fetch items when conversations are loaded
    // The ref prevents duplicate fetches, so we can safely fetch for all conversations
  }, [conversations, updateChatPreview]);

  return { updateChatPreview };
}
