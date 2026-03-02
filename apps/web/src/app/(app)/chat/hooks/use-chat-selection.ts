"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
  bucketKeyFromDisplaySlug,
  displaySlugFromMetadata,
  getBucketKeyFromMetadata,
} from "@/app/chat/utils/bucket-slug";
import type { Conversation } from "@/lib/actions/conversation";

const FALLBACK_BUCKET_SEGMENT = "_";

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
  isSelectedChatStreaming?: boolean;
  isConversationLoading?: boolean;
}

function getNextConversationAfterDelete(
  conversations: Conversation[],
  bucketSlug: string | undefined,
): { nextId: string | null; nextSlug: string } {
  if (conversations.length === 0) {
    return { nextId: null, nextSlug: bucketSlug ?? "" };
  }
  const bucketKey = bucketSlug
    ? bucketKeyFromDisplaySlug(conversations, bucketSlug)
    : null;
  const sameBucket = bucketKey
    ? conversations.filter(
        (c) =>
          getBucketKeyFromMetadata(
            (c.metadata as Record<string, unknown> | null) ?? null,
          ) === bucketKey,
      )
    : [];
  const candidates = sameBucket.length > 0 ? sameBucket : conversations;
  const sorted = [...candidates].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const nextConv = sorted[0] ?? null;
  const nextId = nextConv?.id ?? null;
  const nextSlug = nextConv
    ? displaySlugFromMetadata(
        (nextConv.metadata as Record<string, unknown> | null) ?? null,
      )
    : "";
  return { nextId, nextSlug: nextSlug || bucketSlug || "" };
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
  isSelectedChatStreaming = false,
  isConversationLoading: isConversationLoadingProp = false,
}: UseChatSelectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ bucketSlug?: string }>();
  const bucketSlug = params?.bucketSlug;

  function withSearch(path: string): string {
    const query = searchParams?.toString();
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
      router.push(bucketSlug ? `/chat/${bucketSlug}` : "/chat", {
        scroll: false,
      });
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
    isUpdatingUrlRef.current = true;
    const segment = slug || bucketSlug || FALLBACK_BUCKET_SEGMENT;
    const targetPath = `/chat/${segment}/conversation/${chatId}`;
    router.push(targetPath, { scroll: false });

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
      router.replace(bucketSlug ? `/chat/${bucketSlug}` : "/chat", {
        scroll: false,
      });
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

    if (!pathname.startsWith("/chat")) {
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
        if (conversations.length === 0) {
          pendingUrlConversationIdRef.current = null;
          if (!isConversationsLoading) {
            router.replace(bucketSlug ? `/chat/${bucketSlug}` : "/chat", {
              scroll: false,
            });
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
        const { nextId, nextSlug } = getNextConversationAfterDelete(
          conversations,
          bucketSlug ?? undefined,
        );
        const nextSegment = nextSlug || bucketSlug || FALLBACK_BUCKET_SEGMENT;
        const targetPathForNext = nextId
          ? `/chat/${nextSegment}/conversation/${nextId}`
          : bucketSlug
            ? `/chat/${bucketSlug}`
            : "/chat";
        if (pending === nextId) {
          pendingUrlConversationIdRef.current = null;
          router.replace(withSearch(targetPathForNext), { scroll: false });
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
        router.replace(withSearch(targetPathForNext), { scroll: false });
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
            router.replace(bucketSlug ? `/chat/${bucketSlug}` : "/chat", {
              scroll: false,
            });
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
        const { nextId, nextSlug } = getNextConversationAfterDelete(
          conversations,
          bucketSlug ?? undefined,
        );
        const nextSegment = nextSlug || bucketSlug || FALLBACK_BUCKET_SEGMENT;
        const targetPathForNext = nextId
          ? `/chat/${nextSegment}/conversation/${nextId}`
          : bucketSlug
            ? `/chat/${bucketSlug}`
            : "/chat";
        if (pending === nextId) {
          pendingUrlConversationIdRef.current = null;
          router.replace(withSearch(targetPathForNext), { scroll: false });
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
        router.replace(withSearch(targetPathForNext), { scroll: false });
        handleSelectChat(nextId);
        return;
      }
      // First load with conversation in path: selectedChatId may already match but conversation not loaded
      pendingUrlConversationIdRef.current = null;
      handleSelectChat(currentUrlConversationId);
    } else if (
      !currentUrlConversationId &&
      selectedChatId &&
      pathname.startsWith("/chat")
    ) {
      if (isSelectedChatStreaming || isConversationLoadingProp) {
        return;
      }
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
      // Clear selection to show welcome view
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      setSelectedModel(null);
      selectedModelRef.current = null;
      setMessages([]);
      setInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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
