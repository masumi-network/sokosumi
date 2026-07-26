"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { displaySlugFromMetadata } from "@/app/chat/utils/bucket-slug";
import {
  CHAT_APP_ROUTE_PREFIX,
  FALLBACK_BUCKET_SEGMENT,
} from "@/app/chat-ui/utils/chat-route-base";
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
  isConversationsLoading?: boolean;
  isSelectedChatStreaming?: boolean;
  isConversationLoading?: boolean;
  enabled?: boolean;
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
  isConversationsLoading = false,
  isSelectedChatStreaming = false,
  isConversationLoading: isConversationLoadingProp = false,
  enabled = true,
}: UseChatSelectionProps) {
  const router = useRouter();
  const params = useParams<{ bucketSlug?: string }>();
  const bucketSlug = params?.bucketSlug;

  // Use window.location.search so we preserve open=1 when effect runs (React state can be stale)
  function withSearch(path: string): string {
    if (typeof window === "undefined") return path;
    const query = window.location.search.slice(1);
    return query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
  }

  const handleSelectChat = async (chatId: string | null) => {
    // Do not stop streaming when switching chats so multiple conversations can stream in parallel

    if (!chatId) {
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      pendingUrlConversationIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      isUpdatingUrlRef.current = true;
      router.push(
        bucketSlug
          ? `${CHAT_APP_ROUTE_PREFIX}/${bucketSlug}`
          : CHAT_APP_ROUTE_PREFIX,
        {
          scroll: false,
        },
      );
      return;
    }

    const conv = conversations.find((c) => c.id === chatId);
    const slug = conv
      ? displaySlugFromMetadata(conv.metadata as Record<string, unknown> | null)
      : "";

    // Optimistic update: switch view and URL immediately so conversation switching doesn't lag
    setSelectedChatId(chatId);
    currentChatIdRef.current = chatId;
    pendingUrlConversationIdRef.current = chatId;
    // Pushing a route we are already on restarts the transition, and a server
    // action dispatched in the same tick can be dropped by the router with a
    // promise that never settles — which left the conversation spinner up
    // forever when switching chats. Only navigate when the URL must change.
    if (urlConversationId !== chatId) {
      isUpdatingUrlRef.current = true;
      const segment = slug || bucketSlug || FALLBACK_BUCKET_SEGMENT;
      const targetPath = `${CHAT_APP_ROUTE_PREFIX}/${segment}/conversation/${chatId}`;
      router.push(withSearch(targetPath), { scroll: false });
    }

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
      // A conversation that is still in the loaded list exists — the fetch
      // failed transiently (timeout, dropped action, Core hiccup). Keep the
      // selection so the load effect can retry instead of bouncing the user
      // out of a conversation that is actually there.
      if (conversations.some((c) => c.id === chatId)) {
        return;
      }
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      pendingUrlConversationIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      setMessages([]);
      setInput("");
      isUpdatingUrlRef.current = true;
      router.replace(
        bucketSlug
          ? `${CHAT_APP_ROUTE_PREFIX}/${bucketSlug}`
          : CHAT_APP_ROUTE_PREFIX,
        {
          scroll: false,
        },
      );
      return;
    }

    const conversation = loadedConversation;
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
    if (!enabled) {
      return;
    }

    // Skip if we're updating the URL ourselves
    const wasUpdatingUrl = isUpdatingUrlRef.current;
    const pending = pendingUrlConversationIdRef.current;
    const currentUrlConversationId = urlConversationId;

    if (wasUpdatingUrl) {
      isUpdatingUrlRef.current = false;
      return;
    }

    // Clear pending ref when URL has caught up with our navigation
    if (currentUrlConversationId === selectedChatId) {
      pendingUrlConversationIdRef.current = null;
    }

    if (!pathname.startsWith(CHAT_APP_ROUTE_PREFIX)) {
      return;
    }

    // Handle URL changes: selection differs from URL, or URL conversation not yet loaded
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
        pendingUrlConversationIdRef.current = null;
        void handleSelectChat(currentUrlConversationId);
        return;
      }
      pendingUrlConversationIdRef.current = null;
      handleSelectChat(currentUrlConversationId);
    } else if (urlConversationNotLoaded) {
      if (!conversations.some((c) => c.id === currentUrlConversationId)) {
        pendingUrlConversationIdRef.current = null;
        void handleSelectChat(currentUrlConversationId);
        return;
      }
      // First load with conversation in path: selectedChatId may already match but conversation not loaded
      pendingUrlConversationIdRef.current = null;
      handleSelectChat(currentUrlConversationId);
    } else if (
      !currentUrlConversationId &&
      selectedChatId &&
      pathname.startsWith(CHAT_APP_ROUTE_PREFIX)
    ) {
      if (isSelectedChatStreaming || isConversationLoadingProp) {
        return;
      }
      if (pending === selectedChatId) {
        return;
      }
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      setMessages([]);
      setInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    urlConversationId,
    pathname,
    bucketSlug,
    selectedChatId,
    selectedConversation?.id,
    isConversationsLoading,
    conversations,
  ]);

  return {
    selectChat: handleSelectChat,
  };
}
