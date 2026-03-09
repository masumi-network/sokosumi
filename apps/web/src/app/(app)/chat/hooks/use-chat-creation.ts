"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { displaySlugFromMetadata, slugify } from "@/app/chat/utils/bucket-slug";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { useChatSecondarySidebar } from "@/contexts/chat-secondary-sidebar-context";
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
  pendingUrlConversationIdRef: React.MutableRefObject<string | null>;
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
  pendingUrlConversationIdRef,
  chats,
  conversations,
}: UseChatCreationProps) {
  const router = useRouter();
  const basePath = "/chat";
  const { setShowSecondarySidebar } = useChatSecondarySidebar();
  const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false);
  const [showMessagesAfterTransition, setShowMessagesAfterTransition] =
    useState(true);

  const createModelChat = useCallback(
    async (model: { id: string; name: string }) => {
      const conversation = await createNewConversation(
        {
          model_id: model.id,
          model_name: model.name,
          type: "model",
        },
        model.name,
      );

      if (!conversation) {
        return null;
      }

      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id;
      messagesChatIdRef.current = conversation.id;
      setMessages([]);
      setInput("");

      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || model.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker: undefined,
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
      pendingUrlConversationIdRef.current = conversation.id;
      isUpdatingUrlRef.current = true;
      try {
        sessionStorage.setItem("chat-pending-conversation-id", conversation.id);
      } catch {
        // ignore
      }
      setShowSecondarySidebar(false);
      const slug =
        displaySlugFromMetadata(conversation.metadata ?? null) ||
        `model-${model.id.replace(/\//g, "-")}`;
      router.push(`${basePath}/${slug}/conversation/${conversation.id}`, {
        scroll: false,
      });

      return conversation;
    },
    [
      basePath,
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      setSelectedModel,
      setShowSecondarySidebar,
      router,
      chatMessagesRef,
      previousChatIdRef,
      messagesChatIdRef,
      currentChatIdRef,
      selectedModelRef,
      isUpdatingUrlRef,
      pendingUrlConversationIdRef,
    ],
  );

  const createCoworkerChat = useCallback(
    async (coworker: Coworker) => {
      setSelectedModel(null);
      selectedModelRef.current = null;

      const conversation = await createNewConversation(
        {
          coworker_id: coworker.id,
          coworker_slug: coworker.slug,
          coworker_name: coworker.name,
          coworker_description: coworker.description,
          coworker_useCase: coworker.useCase,
          type: "coworker",
        },
        coworker.name,
      );

      if (!conversation) {
        return null;
      }

      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id;
      messagesChatIdRef.current = conversation.id;
      setMessages([]);
      setInput("");

      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || coworker.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker,
      };
      setChats((prev) => {
        if (prev.find((c) => c.id === conversation.id)) {
          return prev.map((c) =>
            c.id === conversation.id ? { ...c, coworker } : c,
          );
        }
        return [tempChat, ...prev];
      });

      setSelectedChatId(conversation.id);
      currentChatIdRef.current = conversation.id;
      pendingUrlConversationIdRef.current = conversation.id;
      isUpdatingUrlRef.current = true;
      try {
        sessionStorage.setItem("chat-pending-conversation-id", conversation.id);
      } catch {
        // ignore
      }
      setShowSecondarySidebar(false);
      const slug =
        displaySlugFromMetadata(conversation.metadata ?? null) ||
        slugify(coworker.slug) ||
        slugify(coworker.name) ||
        `coworker-${coworker.id}`;
      router.push(`${basePath}/${slug}/conversation/${conversation.id}`, {
        scroll: false,
      });

      return conversation;
    },
    [
      basePath,
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      setSelectedModel,
      setShowSecondarySidebar,
      router,
      chatMessagesRef,
      previousChatIdRef,
      messagesChatIdRef,
      currentChatIdRef,
      selectedModelRef,
      isUpdatingUrlRef,
      pendingUrlConversationIdRef,
    ],
  );

  useEffect(() => {
    if (
      chats.length > 0 &&
      conversations.length > 0 &&
      isWelcomeTransitioning
    ) {
      const immediateId = setTimeout(() => {
        setShowMessagesAfterTransition(false);
      }, 0);

      const showTimer = setTimeout(() => {
        setShowMessagesAfterTransition(true);
      }, 800);

      const resetTimer = setTimeout(() => {
        setIsWelcomeTransitioning(false);
      }, 200);

      return () => {
        clearTimeout(immediateId);
        clearTimeout(showTimer);
        clearTimeout(resetTimer);
      };
    } else if (!isWelcomeTransitioning) {
      const id = setTimeout(() => setShowMessagesAfterTransition(true), 0);
      return () => clearTimeout(id);
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
