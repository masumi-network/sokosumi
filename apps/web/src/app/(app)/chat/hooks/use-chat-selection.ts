"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { Conversation } from "@/lib/actions/conversation";

interface UseChatSelectionProps {
  urlConversationId: string | null;
  pathname: string;
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  selectConversation: (id: string) => Promise<void>;
  selectedChatId: string | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedModel: (model: { id: string; name: string } | null) => void;
  selectedModelRef: React.MutableRefObject<{ id: string; name: string } | null>;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  setInput: (input: string) => void;
  currentChatIdRef: React.MutableRefObject<string | null>;
  previousChatIdRef: React.MutableRefObject<string | null>;
  isUpdatingUrlRef: React.MutableRefObject<boolean>;
}

/**
 * Hook to handle chat selection logic and URL synchronization
 */
export function useChatSelection({
  urlConversationId,
  pathname,
  conversations,
  selectedConversation,
  selectConversation,
  selectedChatId,
  setSelectedChatId,
  setSelectedModel,
  selectedModelRef,
  setMessages,
  setInput,
  currentChatIdRef,
  previousChatIdRef,
  isUpdatingUrlRef,
}: UseChatSelectionProps) {
  const router = useRouter();

  const handleSelectChat = async (chatId: string | null) => {
    if (!chatId) {
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      isUpdatingUrlRef.current = true;
      router.push("/chat", { scroll: false });
      return;
    }

    // Load conversation from DB
    await selectConversation(chatId);

    // Load model info from conversation metadata if it's a model conversation
    // Use selectedConversation if available, otherwise find in conversations list
    const conversation =
      selectedConversation?.id === chatId
        ? selectedConversation
        : conversations.find((c) => c.id === chatId);
    if (conversation) {
      const metadata = conversation.metadata as Record<string, unknown> | null;
      const conversationType = metadata?.type as string | undefined;
      const modelId = metadata?.model_id as string | undefined;
      const modelName = metadata?.model_name as string | undefined;

      if (conversationType === "model" && modelId && modelName) {
        setSelectedModel({ id: modelId, name: modelName });
        selectedModelRef.current = { id: modelId, name: modelName };
      } else {
        setSelectedModel(null);
        selectedModelRef.current = null;
      }
    }

    setSelectedChatId(chatId);
    // Update ref immediately for synchronous access in prepareSendMessagesRequest
    currentChatIdRef.current = chatId;
    // Update URL to reflect selected conversation using router for consistency
    isUpdatingUrlRef.current = true;
    router.push(`/chat?conversationId=${chatId}`, { scroll: false });
  };

  // Sync URL parameter with selectedChatId on mount and when URL changes
  // Only sync when URL changes externally (not when we update it ourselves)
  useEffect(() => {
    // Skip if we're updating the URL ourselves
    if (isUpdatingUrlRef.current) {
      isUpdatingUrlRef.current = false;
      return;
    }

    // Only process if we're on the /chat route
    if (pathname !== "/chat") {
      return;
    }

    // Get conversationId from URL (check both useSearchParams and window.location as fallback)
    const currentUrlConversationId =
      urlConversationId ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("conversationId")
        : null);

    // Handle URL changes
    if (
      currentUrlConversationId &&
      currentUrlConversationId !== selectedChatId
    ) {
      // URL has a conversationId that differs from current selection - select it
      handleSelectChat(currentUrlConversationId);
    } else if (
      !currentUrlConversationId &&
      selectedChatId &&
      pathname === "/chat"
    ) {
      // URL has no conversationId but we have a selected chat - clear selection to show welcome view
      // Only clear if we're on /chat route to avoid clearing when navigating away
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      setMessages([]);
      setInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlConversationId, pathname, selectedChatId]);

  return {
    selectChat: handleSelectChat,
  };
}
