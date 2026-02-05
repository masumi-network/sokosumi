"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { Chat, Coworker } from "@/app/chat/utils/types";
import type { Conversation } from "@/lib/actions/conversation";

interface UseChatCreationProps {
  createNewConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<Conversation | null>;
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  setSelectedChatId: (id: string | null) => void;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  setInput: (input: string) => void;
  currentChatIdRef: React.MutableRefObject<string | null>;
  previousChatIdRef: React.MutableRefObject<string | null>;
  messagesChatIdRef: React.MutableRefObject<string | null>;
  chatMessagesRef: React.MutableRefObject<Map<string, unknown[]>>;
  selectedModelRef: React.MutableRefObject<{ id: string; name: string } | null>;
  setSelectedModel: (model: { id: string; name: string } | null) => void;
  isUpdatingUrlRef: React.MutableRefObject<boolean>;
  chats: Chat[];
  conversations: Conversation[];
}

/**
 * Hook to handle creating new chats (model or coworker) and transition state
 */
export function useChatCreation({
  createNewConversation,
  setChats,
  setSelectedChatId,
  setMessages,
  setInput,
  currentChatIdRef,
  previousChatIdRef,
  messagesChatIdRef,
  chatMessagesRef,
  selectedModelRef,
  setSelectedModel,
  isUpdatingUrlRef,
  chats,
  conversations,
}: UseChatCreationProps) {
  const router = useRouter();
  const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false);
  const [showMessagesAfterTransition, setShowMessagesAfterTransition] =
    useState(true);

  const createModelChat = useCallback(
    async (model: { id: string; name: string }) => {
      // Create conversation with model metadata
      const conversation = await createNewConversation(
        {
          model_id: model.id,
          model_name: model.name,
          type: "model", // Mark as model conversation
        },
        model.name,
      );

      if (!conversation) {
        return null; // Error handling is done in the hook
      }

      // Initialize empty messages for new chat
      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id;
      messagesChatIdRef.current = conversation.id;
      setMessages([]);
      setInput("");

      // Add to chats list
      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || model.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker: undefined, // No coworker for model conversations
        model: { id: model.id, name: model.name },
      };
      setChats((prev) => {
        if (prev.find((c) => c.id === conversation.id)) {
          return prev.map((c) =>
            c.id === conversation.id ? { ...c, ...tempChat } : c,
          );
        }
        return [tempChat, ...prev];
      });

      setSelectedChatId(conversation.id);
      currentChatIdRef.current = conversation.id;
      selectedModelRef.current = model;
      setSelectedModel(model);
      isUpdatingUrlRef.current = true;
      router.push(`/chat?conversationId=${conversation.id}`, { scroll: false });

      return conversation;
    },
    [
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      router,
      chatMessagesRef,
      previousChatIdRef,
      messagesChatIdRef,
      currentChatIdRef,
      selectedModelRef,
      isUpdatingUrlRef,
    ],
  );

  const createCoworkerChat = useCallback(
    async (coworker: Coworker) => {
      // Clear model selection when selecting coworker
      setSelectedModel(null);
      selectedModelRef.current = null;

      // Create conversation and store in DB
      const conversation = await createNewConversation(
        {
          coworker_id: coworker.id,
          coworker_name: coworker.name,
          coworker_description: coworker.description,
          coworker_useCase: coworker.useCase,
          type: "coworker", // Mark as coworker conversation
        },
        coworker.name,
      );

      if (!conversation) {
        return null; // Error handling is done in the hook
      }

      // Initialize empty messages for new chat
      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id; // Set ref immediately to prevent preview updates
      messagesChatIdRef.current = conversation.id; // Track that messages belong to this chat
      setMessages([]);
      setInput("");

      // Temporarily add to chats with full coworker info so sync effect can preserve it
      // The sync effect will update it properly when conversations state updates
      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || coworker.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker,
      };
      setChats((prev) => {
        // Check if already exists (from sync effect)
        if (prev.find((c) => c.id === conversation.id)) {
          return prev.map((c) =>
            c.id === conversation.id ? { ...c, coworker } : c,
          );
        }
        return [tempChat, ...prev];
      });

      setSelectedChatId(conversation.id);
      // Update ref immediately for synchronous access in prepareSendMessagesRequest
      currentChatIdRef.current = conversation.id;
      // Update URL to reflect selected conversation using router for consistency
      isUpdatingUrlRef.current = true;
      router.push(`/chat?conversationId=${conversation.id}`, { scroll: false });

      return conversation;
    },
    [
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      router,
      chatMessagesRef,
      previousChatIdRef,
      messagesChatIdRef,
      currentChatIdRef,
      selectedModelRef,
      isUpdatingUrlRef,
    ],
  );

  // Reset transition state when chats are loaded
  useEffect(() => {
    if (
      chats.length > 0 &&
      conversations.length > 0 &&
      isWelcomeTransitioning
    ) {
      // Hide messages during transition to prevent layout shifts
      setShowMessagesAfterTransition(false);

      // Show messages after animation completes (300ms delay + 500ms duration = 800ms)
      const showTimer = setTimeout(() => {
        setShowMessagesAfterTransition(true);
      }, 800);

      // Reset transition state after animation completes
      const resetTimer = setTimeout(() => {
        setIsWelcomeTransitioning(false);
      }, 200);

      return () => {
        clearTimeout(showTimer);
        clearTimeout(resetTimer);
      };
    } else if (!isWelcomeTransitioning) {
      // Ensure messages are shown when not transitioning
      setShowMessagesAfterTransition(true);
    }
  }, [chats.length, conversations.length, isWelcomeTransitioning]);

  return {
    createModelChat,
    createCoworkerChat,
    isWelcomeTransitioning,
    setIsWelcomeTransitioning,
    showMessagesAfterTransition,
  };
}
