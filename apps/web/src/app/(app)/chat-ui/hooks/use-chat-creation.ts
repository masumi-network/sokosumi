"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import { displaySlugFromMetadata, slugify } from "@/app/chat/utils/bucket-slug";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import {
  CHAT_APP_ROUTE_PREFIX,
  getPendingConversationStorageKey,
} from "@/app/chat-ui/utils/chat-route-base";
import type { Conversation } from "@/lib/actions/conversation";

interface ChatCreationOptions {
  deferNavigation?: boolean;
}

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
  navigateToConversation?: (
    conversation: Conversation,
    slug: string,
  ) => void | Promise<void>;
  isRouteDriven?: boolean;
}

/**
 * Hook to handle creating new coworker chats and transition state.
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
  navigateToConversation,
  isRouteDriven = true,
}: UseChatCreationProps) {
  const router = useRouter();
  const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false);
  const [showMessagesAfterTransition, setShowMessagesAfterTransition] =
    useState(true);

  const createCoworkerChat = useCallback(
    async (coworker: Coworker, options?: ChatCreationOptions) => {
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

      // Org workspaces also own a `kind:direct` room for this coworker 1:1
      // (create-or-get). Conversation + AI SDK stream stay the /chat path;
      // do not block send on room ensure.
      void ensureCoworkerDirectRoomAction(coworker.id);

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
      if (isRouteDriven) {
        pendingUrlConversationIdRef.current = conversation.id;
        isUpdatingUrlRef.current = true;
        try {
          sessionStorage.setItem(
            getPendingConversationStorageKey(),
            conversation.id,
          );
        } catch {
          // ignore
        }
      }
      const slug =
        displaySlugFromMetadata(conversation.metadata ?? null) ||
        slugify(coworker.slug) ||
        slugify(coworker.name) ||
        `coworker-${coworker.id}`;

      if (!options?.deferNavigation) {
        if (navigateToConversation) {
          void navigateToConversation(conversation, slug);
        } else {
          router.push(
            `${CHAT_APP_ROUTE_PREFIX}/${slug}/conversation/${conversation.id}`,
            {
              scroll: false,
            },
          );
        }
      } else if (navigateToConversation) {
        void navigateToConversation(conversation, slug);
      }

      return conversation;
    },
    [
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      setSelectedModel,
      router,
      navigateToConversation,
      chatMessagesRef,
      previousChatIdRef,
      messagesChatIdRef,
      currentChatIdRef,
      selectedModelRef,
      isUpdatingUrlRef,
      pendingUrlConversationIdRef,
      isRouteDriven,
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
    createCoworkerChat,
    isWelcomeTransitioning,
    setIsWelcomeTransitioning,
    showMessagesAfterTransition,
    setShowMessagesAfterTransition,
  };
}
