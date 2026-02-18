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
  selectConversation: (id: string) => Promise<Conversation | null>;
  selectedChatId: string | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedModel: (model: { id: string; name: string } | null) => void;
  selectedModelRef: React.MutableRefObject<{ id: string; name: string } | null>;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  setInput: (input: string) => void;
  currentChatIdRef: React.MutableRefObject<string | null>;
  previousChatIdRef: React.MutableRefObject<string | null>;
  isUpdatingUrlRef: React.MutableRefObject<boolean>;
  pendingUrlConversationIdRef: React.MutableRefObject<string | null>;
  stopStreaming: () => void;
  isConversationsLoading?: boolean;
}

/**
 * Hook to handle chat selection logic and URL synchronization
 */
function setSelectedModelFromConversation(
  conv: Conversation,
  setSelectedModel: UseChatSelectionProps["setSelectedModel"],
  selectedModelRef: UseChatSelectionProps["selectedModelRef"],
) {
  const metadata = conv.metadata as Record<string, unknown> | null;
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
  previousChatIdRef: _previousChatIdRef,
  isUpdatingUrlRef,
  pendingUrlConversationIdRef,
  stopStreaming: _stopStreaming,
  isConversationsLoading = false,
}: UseChatSelectionProps) {
  const router = useRouter();

  const handleSelectChat = async (chatId: string | null) => {
    // Do not stop streaming when switching chats so multiple conversations can stream in parallel

    if (!chatId) {
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      pendingUrlConversationIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      isUpdatingUrlRef.current = true;
      router.push("/chat", { scroll: false });
      return;
    }

    // Optimistic update: switch view and URL immediately so conversation switching doesn't lag
    setSelectedChatId(chatId);
    currentChatIdRef.current = chatId;
    pendingUrlConversationIdRef.current = chatId;
    isUpdatingUrlRef.current = true;
    router.push(`/chat?conversationId=${chatId}`, { scroll: false });

    // Set model/coworker from list immediately so the input doesn't show the previous chat's agent
    const listConversation = conversations.find((c) => c.id === chatId);
    if (listConversation) {
      setSelectedModelFromConversation(
        listConversation,
        setSelectedModel,
        selectedModelRef,
      );
    } else {
      setSelectedModel(null);
      selectedModelRef.current = null;
    }

    // Load conversation from DB; refine model/coworker when done (e.g. fresh metadata)
    const loadedConversation = await selectConversation(chatId);

    // Stale-request guard: only update model if this chatId is still selected
    if (currentChatIdRef.current !== chatId) {
      return;
    }

    if (loadedConversation === null) {
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      pendingUrlConversationIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      setMessages([]);
      setInput("");
      isUpdatingUrlRef.current = true;
      router.replace("/chat", { scroll: false });
      return;
    }

    const conversation =
      loadedConversation ?? conversations.find((c) => c.id === chatId);
    if (conversation) {
      setSelectedModelFromConversation(
        conversation,
        setSelectedModel,
        selectedModelRef,
      );
    }
  };

  // Sync URL parameter with selectedChatId on mount and when URL changes
  // Only sync when URL changes externally (not when we update it ourselves)
  useEffect(() => {
    // Skip if we're updating the URL ourselves
    const wasUpdatingUrl = isUpdatingUrlRef.current;
    const pending = pendingUrlConversationIdRef.current;
    const currentUrlConversationId =
      urlConversationId ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("conversationId")
        : null);

    if (wasUpdatingUrl) {
      isUpdatingUrlRef.current = false;
      return;
    }

    // Clear pending ref when URL has caught up with our navigation
    if (currentUrlConversationId === selectedChatId) {
      pendingUrlConversationIdRef.current = null;
    }

    // Only process if we're on the /chat route
    if (pathname !== "/chat") {
      return;
    }

    // Handle URL changes: selection differs from URL, or URL conversation not yet loaded (first load with ?conversationId=)
    const urlConversationNotLoaded =
      currentUrlConversationId &&
      selectedConversation?.id !== currentUrlConversationId;
    const urlDiffersFromSelection =
      currentUrlConversationId && currentUrlConversationId !== selectedChatId;
    if (urlDiffersFromSelection) {
      // Only skip when the URL already shows the conversation we just selected (our own push).
      if (pending === currentUrlConversationId) {
        pendingUrlConversationIdRef.current = null;
        return;
      }
      if (!conversations.some((c) => c.id === currentUrlConversationId)) {
        if (conversations.length === 0) {
          pendingUrlConversationIdRef.current = null;
          if (!isConversationsLoading) {
            router.replace("/chat", { scroll: false });
            setSelectedChatId(null);
            currentChatIdRef.current = null;
            setSelectedModel(null);
            selectedModelRef.current = null;
            setMessages([]);
            setInput("");
            return;
          }
          handleSelectChat(currentUrlConversationId);
          return;
        }
        const sorted = [...conversations].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        const nextId = sorted[0]?.id ?? null;
        if (pending === nextId) {
          pendingUrlConversationIdRef.current = null;
          const targetPath = nextId
            ? `/chat?conversationId=${nextId}`
            : "/chat";
          router.replace(targetPath, { scroll: false });
          if (nextId === null) {
            setSelectedChatId(null);
            currentChatIdRef.current = null;
            setSelectedModel(null);
            selectedModelRef.current = null;
            setMessages([]);
            setInput("");
          }
          return;
        }
        pendingUrlConversationIdRef.current = null;
        const targetPath = nextId ? `/chat?conversationId=${nextId}` : "/chat";
        router.replace(targetPath, { scroll: false });
        handleSelectChat(nextId);
        return;
      }
      pendingUrlConversationIdRef.current = null;
      handleSelectChat(currentUrlConversationId);
    } else if (urlConversationNotLoaded) {
      if (!conversations.some((c) => c.id === currentUrlConversationId)) {
        if (conversations.length === 0) {
          pendingUrlConversationIdRef.current = null;
          if (!isConversationsLoading) {
            router.replace("/chat", { scroll: false });
            setSelectedChatId(null);
            currentChatIdRef.current = null;
            setSelectedModel(null);
            selectedModelRef.current = null;
            setMessages([]);
            setInput("");
            return;
          }
          handleSelectChat(currentUrlConversationId);
          return;
        }
        const sorted = [...conversations].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        const nextId = sorted[0]?.id ?? null;
        if (pending === nextId) {
          pendingUrlConversationIdRef.current = null;
          const targetPath = nextId
            ? `/chat?conversationId=${nextId}`
            : "/chat";
          router.replace(targetPath, { scroll: false });
          if (nextId === null) {
            setSelectedChatId(null);
            currentChatIdRef.current = null;
            setSelectedModel(null);
            selectedModelRef.current = null;
            setMessages([]);
            setInput("");
          }
          return;
        }
        pendingUrlConversationIdRef.current = null;
        const targetPath = nextId ? `/chat?conversationId=${nextId}` : "/chat";
        router.replace(targetPath, { scroll: false });
        handleSelectChat(nextId);
        return;
      }
      // First load with conversationId in URL: selectedChatId may already match but conversation not loaded
      pendingUrlConversationIdRef.current = null;
      handleSelectChat(currentUrlConversationId);
    } else if (
      !currentUrlConversationId &&
      selectedChatId &&
      pathname === "/chat"
    ) {
      // Don't clear if we're waiting for our own router.push to complete (e.g. new chat creation)
      // When creating, selectedChatId is the new conversation not yet in the list
      // When conversations is empty, we're not creating (e.g. deleted last chat) – always clear
      const isLikelyCreating =
        conversations.length > 0 &&
        pending === selectedChatId &&
        !conversations.some((c) => c.id === selectedChatId);
      if (isLikelyCreating) {
        pendingUrlConversationIdRef.current = null;
        return;
      }
      const actualUrlConversationId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("conversationId")
          : null;

      // Only clear if URL truly has no conversationId
      // This prevents clearing when useSearchParams temporarily returns null during re-renders
      if (!actualUrlConversationId) {
        // Clear selection to show welcome view
        setSelectedChatId(null);
        currentChatIdRef.current = null;
        setSelectedModel(null);
        selectedModelRef.current = null;
        setMessages([]);
        setInput("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlConversationId,
    pathname,
    selectedChatId,
    selectedConversation?.id,
    isConversationsLoading,
  ]);

  return {
    selectChat: handleSelectChat,
  };
}
