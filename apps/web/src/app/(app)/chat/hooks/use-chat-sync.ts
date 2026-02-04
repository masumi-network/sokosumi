"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import type { Chat, Coworker } from "@/app/chat/utils/types";
import type { Conversation } from "@/lib/actions/conversation";

interface UseChatSyncProps {
  conversations: Conversation[];
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  selectedChatId: string | null;
  setSelectedModel: (model: { id: string; name: string } | null) => void;
  selectedModelRef: React.MutableRefObject<{ id: string; name: string } | null>;
}

/**
 * Hook to sync conversations from DB to local chats state
 */
export function useChatSync({
  conversations,
  chats,
  setChats,
  selectedChatId,
  setSelectedModel,
  selectedModelRef,
}: UseChatSyncProps) {
  const t = useTranslations("App.Chat.Chat");

  // Sync conversations from DB to chats state
  useEffect(() => {
    if (conversations.length === 0 && chats.length === 0) {
      return; // Don't clear chats if conversations haven't loaded yet
    }

    requestAnimationFrame(() => {
      const mappedChats: Chat[] = conversations.map((conv: Conversation) => {
        const metadata = conv.metadata as Record<string, unknown> | null;
        const coworkerId = metadata?.coworker_id as string | undefined;
        const coworkerName = metadata?.coworker_name as string | undefined;
        const modelId = metadata?.model_id as string | undefined;
        const modelName = metadata?.model_name as string | undefined;
        const conversationType = metadata?.type as string | undefined;

        // Find existing chat to preserve UI state (lastMessage, etc.)
        const existingChat = chats.find((c) => c.id === conv.id);

        // Build coworker object from metadata or existing chat
        let coworker: Coworker | undefined;
        if (existingChat?.coworker) {
          coworker = existingChat.coworker;
        } else if (
          coworkerId &&
          coworkerName &&
          conversationType === "coworker"
        ) {
          // For new conversations, we need to get full coworker info
          // For now, create a minimal coworker - the full info will be preserved from handleCoworkerSelected
          coworker = {
            id: coworkerId,
            name: coworkerName,
            description: "", // Will be filled from existing chat if available
            useCase: "", // Will be filled from existing chat if available
          };
        }

        // Load model info if this is a model conversation
        if (
          conversationType === "model" &&
          modelId &&
          modelName &&
          conv.id === selectedChatId
        ) {
          setSelectedModel({ id: modelId, name: modelName });
          selectedModelRef.current = { id: modelId, name: modelName };
        } else if (
          conversationType === "coworker" &&
          conv.id === selectedChatId
        ) {
          // Clear model selection for coworker conversations
          setSelectedModel(null);
          selectedModelRef.current = null;
        }

        // Build model object from metadata
        let model: { id: string; name: string } | undefined;
        if (conversationType === "model" && modelId && modelName) {
          model = { id: modelId, name: modelName };
        }

        // Get lastMessage from existing chat (preserved from previous state)
        // Note: Last message will be updated when messages are loaded from DB
        const lastMessage = existingChat?.lastMessage;
        const lastMessageTime = existingChat?.lastMessageTime;

        return {
          id: conv.id,
          title: conv.title || coworkerName || modelName || t("newChat"),
          createdAt: new Date(conv.createdAt),
          updatedAt: new Date(conv.updatedAt),
          status: (existingChat?.status || "active") as Chat["status"],
          coworker,
          model,
          lastMessage,
          lastMessageTime,
        };
      });

      // Check if we need to update (avoid infinite loops)
      const needsUpdate =
        mappedChats.length !== chats.length ||
        mappedChats.some(
          (chat, index) =>
            chat.id !== chats[index]?.id ||
            chat.updatedAt.getTime() !== chats[index]?.updatedAt.getTime(),
        );

      if (needsUpdate) {
        setChats(mappedChats);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, t]); // Don't include chats in deps to avoid infinite loop
}
