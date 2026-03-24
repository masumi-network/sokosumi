"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { Loader2 } from "lucide-react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useChatCreation } from "@/app/chat/hooks/use-chat-creation";
import { useChatMessages } from "@/app/chat/hooks/use-chat-messages";
import { useChatPreview } from "@/app/chat/hooks/use-chat-preview";
import { useChatSelection } from "@/app/chat/hooks/use-chat-selection";
import { useChatSync } from "@/app/chat/hooks/use-chat-sync";
import { usePendingResponsePolling } from "@/app/chat/hooks/use-pending-response-polling";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { Conversation } from "@/lib/actions/conversation";

import ChatInputContainer from "./chat-input-container";
import MessageList from "./message-list";
import SelectCoworkerModal from "./select-coworker-modal";
import WelcomeScreen from "./welcome-screen";

const NUM_SLOTS = 3;

interface SlotPayload {
  conversationId: string | null;
  model: { id: string; name: string } | null;
}

interface ChatInterfaceProps {
  mobileKeyboardOptimized?: boolean;
  showGreetingAndSuggestions?: boolean;
  organizationSlug: string | null;
  userImageUrl: string;
  userName?: string;
  navigationMode?: "route" | "controlled";
  controlledConversationId?: string | null;
  onConversationCreated?: (conversationId: string) => void;
}

export default function ChatInterface({
  mobileKeyboardOptimized = false,
  showGreetingAndSuggestions = true,
  organizationSlug,
  userImageUrl,
  userName,
  navigationMode = "route",
  controlledConversationId = null,
  onConversationCreated,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Chat.Chat");
  const params = useParams<{ conversationId?: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isRouteDriven = navigationMode === "route";
  const isChatPath = pathname.startsWith("/chat");
  const urlConversationId = isRouteDriven
    ? (params?.conversationId ?? null)
    : controlledConversationId;

  const {
    conversations,
    selectedConversation,
    createNewConversation,
    selectConversation,
    deleteConversationById: _deleteConversationById,
    refreshConversations,
    isLoading: isConversationsLoading,
  } = useConversationsContext();

  const [chats, setChats] = useState<Chat[]>([]);
  const [input, setInput] = useState<string>("");
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    urlConversationId || null,
  );

  const urlIdInList =
    !urlConversationId ||
    conversations.length === 0 ||
    conversations.some((c) => c.id === urlConversationId);

  const organizationSlugRef = useRef<string | null>(organizationSlug);
  useEffect(() => {
    organizationSlugRef.current = organizationSlug;
  }, [organizationSlug]);

  const loadingConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChatId) return;
    if (isRouteDriven && !isChatPath) return;
    if (selectedConversation?.id === selectedChatId) {
      loadingConversationIdRef.current = null;
      return;
    }
    if (loadingConversationIdRef.current === selectedChatId) return;
    loadingConversationIdRef.current = selectedChatId;
    void selectConversation(selectedChatId);
  }, [
    isChatPath,
    isRouteDriven,
    selectedChatId,
    selectedConversation?.id,
    selectConversation,
  ]);

  const { coworkers } = useCoworkersContext();

  const welcomeCoworkerSlug = searchParams?.get("coworker") ?? null;
  const defaultWelcomeSlug = "elena";
  const initialWelcomeCoworker = useMemo(() => {
    if (welcomeCoworkerSlug) {
      const slug = welcomeCoworkerSlug.toLowerCase();
      return (
        coworkers.find((c) => c.slug?.toLowerCase() === slug) ??
        coworkers.find((c) => c.id.toLowerCase() === slug)
      );
    }
    return (
      coworkers.find(
        (c) =>
          c.slug?.toLowerCase() === defaultWelcomeSlug ||
          c.id?.toLowerCase() === defaultWelcomeSlug,
      ) ??
      coworkers[0] ??
      null
    );
  }, [coworkers, welcomeCoworkerSlug]);

  const [welcomeSelectedCoworker, setWelcomeSelectedCoworker] =
    useState<Coworker | null>(null);
  const [welcomeSelectedModel, setWelcomeSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const effectiveWelcomeCoworker =
    welcomeSelectedModel != null
      ? null
      : welcomeCoworkerSlug != null
        ? initialWelcomeCoworker
        : (welcomeSelectedCoworker ?? initialWelcomeCoworker);

  const handleWelcomeCoworkerChange = useCallback((coworker: Coworker) => {
    setWelcomeSelectedCoworker(coworker);
    setWelcomeSelectedModel(null);
  }, []);

  const handleWelcomeModelChange = useCallback(
    (model: { id: string; name: string } | null) => {
      setWelcomeSelectedModel(model);
      if (model) setWelcomeSelectedCoworker(null);
    },
    [],
  );

  useEffect(() => {
    if (isRouteDriven && !urlConversationId && isChatPath) {
      setWelcomeSelectedCoworker(null);
      setWelcomeSelectedModel(null);
    }
  }, [isChatPath, isRouteDriven, urlConversationId]);

  const selectedModelRef = useRef<{ id: string; name: string } | null>(null);
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const messagesChatIdRef = useRef<string | null>(null);
  const previousChatIdRef = useRef<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const isUpdatingUrlRef = useRef(false);
  const pendingUrlConversationIdRef = useRef<string | null>(null);
  const updateChatPreviewRef = useRef<
    ((chatId: string, content: string, isFirstMessage?: boolean) => void) | null
  >(null);

  const PENDING_CONVERSATION_STORAGE_KEY = "chat-pending-conversation-id";

  useEffect(() => {
    if (isRouteDriven) {
      return;
    }

    setSelectedChatId(controlledConversationId);

    if (controlledConversationId !== null) {
      return;
    }

    loadingConversationIdRef.current = null;
    currentChatIdRef.current = null;
    pendingUrlConversationIdRef.current = null;
    setSelectedModel(null);
    selectedModelRef.current = null;
    setInput("");
    setWelcomeSelectedCoworker(null);
    setWelcomeSelectedModel(null);
  }, [controlledConversationId, isRouteDriven, setSelectedModel]);

  useEffect(() => {
    if (!isRouteDriven) {
      return;
    }

    const willSync =
      urlConversationId && selectedChatId !== urlConversationId && urlIdInList;
    const pending = pendingUrlConversationIdRef.current;
    let pendingFromStorage: string | null = null;
    try {
      pendingFromStorage = sessionStorage.getItem(
        PENDING_CONVERSATION_STORAGE_KEY,
      );
    } catch {}
    const skipSync =
      willSync &&
      (pending != null
        ? pending === selectedChatId
        : pendingFromStorage === selectedChatId);
    if (
      (skipSync && pendingFromStorage === selectedChatId) ||
      (urlConversationId === selectedChatId && selectedChatId)
    ) {
      try {
        sessionStorage.removeItem(PENDING_CONVERSATION_STORAGE_KEY);
      } catch {}
    }
    if (willSync && !skipSync) {
      setSelectedChatId(urlConversationId);
    }
  }, [isRouteDriven, urlConversationId, selectedChatId, urlIdInList]);

  const [conversationToSlot, setConversationToSlot] = useState<
    Map<string, number>
  >(new Map());
  const [slotToConversation, setSlotToConversation] = useState<
    Map<number, string>
  >(new Map());
  const [cachedMessagesByConversation, setCachedMessagesByConversation] =
    useState<Record<string, UIMessage[]>>({});
  const [reasoningBySlot, setReasoningBySlot] = useState<
    Record<number, Array<{ id: string; message: string }>>
  >({});
  const reasoningStartedAtBySlotRef = useRef<Record<number, number>>({});
  const [reasoningEndedAtBySlot, setReasoningEndedAtBySlot] = useState<
    Record<number, number>
  >({});
  const slotPayloadRef = useRef<SlotPayload[]>(
    Array.from({ length: NUM_SLOTS }, () => ({
      conversationId: null,
      model: null,
    })),
  );

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    slotToConversation.forEach((convId, slot) => {
      const current = slotPayloadRef.current[slot];
      if (current?.conversationId !== convId) {
        slotPayloadRef.current[slot] = {
          conversationId: convId,
          model: selectedModelRef.current,
        };
      }
    });
  }, [slotToConversation]);

  function makeSlotTransport(slotIndex: number) {
    return new DefaultChatTransport({
      api: "/api/chat",
      headers: () => {
        const slug = organizationSlugRef.current;
        return slug
          ? { "x-organization-slug": slug }
          : ({} as Record<string, string>);
      },
      prepareSendMessagesRequest(request: {
        messages: unknown[];
        body?: Record<string, unknown>;
      }) {
        setReasoningBySlot((prev) => {
          const next = { ...prev };
          delete next[slotIndex];
          return next;
        });
        setReasoningEndedAtBySlot((prev) => {
          const next = { ...prev };
          delete next[slotIndex];
          return next;
        });
        delete reasoningStartedAtBySlotRef.current[slotIndex];
        const payload = slotPayloadRef.current[slotIndex];
        return {
          body: {
            messages: request.messages,
            ...(payload?.conversationId
              ? { conversationId: payload.conversationId }
              : {}),
            ...(payload?.model ? { model: payload.model.id } : {}),
            ...request.body,
          },
        };
      },
    });
  }

  const transport0 = useMemo(() => makeSlotTransport(0), []);
  const transport1 = useMemo(() => makeSlotTransport(1), []);
  const transport2 = useMemo(() => makeSlotTransport(2), []);

  const onDataForSlot = useCallback((slotIndex: number) => {
    return (dataPart: { type: string; data: unknown }) => {
      if (dataPart.type !== "data-reasoning" || dataPart.data == null) return;
      const data = dataPart.data as { message?: string; id?: string };
      const message = typeof data.message === "string" ? data.message : "";
      const id =
        typeof data.id === "string"
          ? data.id
          : `reasoning-${slotIndex}-${Date.now()}`;
      setReasoningBySlot((prev) => {
        const list = prev[slotIndex] ?? [];
        if (list.length === 0) {
          reasoningStartedAtBySlotRef.current[slotIndex] = Date.now();
        }
        const existingIndex = list.findIndex((r) => r.id === id);
        const nextList =
          existingIndex >= 0
            ? list.map((r, i) => (i === existingIndex ? { ...r, message } : r))
            : [...list, { id, message }];
        return { ...prev, [slotIndex]: nextList };
      });
    };
  }, []);

  const onFinishForSlot = useCallback(
    (slotIndex: number) =>
      ({ messages: finishedMessages }: { messages: UIMessage[] }) => {
        const payload = slotPayloadRef.current[slotIndex];
        const conversationId = payload?.conversationId ?? null;
        if (!conversationId || finishedMessages.length === 0) return;

        void refreshConversations();

        const lastAssistantMessage = [...finishedMessages]
          .reverse()
          .find((msg) => msg.role === "assistant");
        if (lastAssistantMessage) {
          const content = extractMessageContent(lastAssistantMessage);
          if (
            content &&
            previousChatIdRef.current === conversationId &&
            messagesChatIdRef.current === conversationId &&
            updateChatPreviewRef.current
          ) {
            const isFirstAssistantMessage =
              finishedMessages.filter((m) => m.role === "assistant").length ===
              1;
            updateChatPreviewRef.current(
              conversationId,
              content,
              isFirstAssistantMessage,
            );
          }
        }
      },
    [refreshConversations],
  );

  const chat0 = useChat({
    transport: transport0,
    onData: onDataForSlot(0),
    onError: (error: unknown) =>
      console.error("Chat API error (slot 0):", error),
    onFinish: onFinishForSlot(0),
  });
  const chat1 = useChat({
    transport: transport1,
    onData: onDataForSlot(1),
    onError: (error: unknown) =>
      console.error("Chat API error (slot 1):", error),
    onFinish: onFinishForSlot(1),
  });
  const chat2 = useChat({
    transport: transport2,
    onData: onDataForSlot(2),
    onError: (error: unknown) =>
      console.error("Chat API error (slot 2):", error),
    onFinish: onFinishForSlot(2),
  });

  const slotMessages = useMemo(
    () => [chat0.messages, chat1.messages, chat2.messages],
    [chat0.messages, chat1.messages, chat2.messages],
  );
  const slotMessagesSignature = useMemo(
    () =>
      slotMessages
        .map((m, i) => {
          const arr = m as UIMessage[] | undefined;
          const len = arr?.length ?? 0;
          const last = len
            ? (arr?.[len - 1] as { id?: string } | undefined)
            : null;
          return `${i}:${len}:${last?.id ?? ""}`;
        })
        .join("|"),
    [slotMessages],
  );
  const slotStatuses = useMemo(
    () => [chat0.status, chat1.status, chat2.status],
    [chat0.status, chat1.status, chat2.status],
  );
  const setMessagesSlots = useMemo(
    () => [chat0.setMessages, chat1.setMessages, chat2.setMessages],
    [chat0.setMessages, chat1.setMessages, chat2.setMessages],
  );
  const sendMessageSlots = useMemo(
    () => [chat0.sendMessage, chat1.sendMessage, chat2.sendMessage],
    [chat0.sendMessage, chat1.sendMessage, chat2.sendMessage],
  );
  const stopSlots = useMemo(
    () => [chat0.stop, chat1.stop, chat2.stop],
    [chat0.stop, chat1.stop, chat2.stop],
  );

  const streamingConversationIdsRef = useRef<Set<string>>(new Set());
  const streamingIds = useMemo(() => {
    const set = new Set<string>();
    conversationToSlot.forEach((slot, convId) => {
      const s = slotStatuses[slot];
      if (s === "streaming" || s === "submitted") set.add(convId);
    });
    return set;
  }, [conversationToSlot, slotStatuses]);
  useLayoutEffect(() => {
    streamingConversationIdsRef.current = streamingIds;
  }, [streamingIds]);

  const displayedMessages = useMemo(() => {
    if (!selectedChatId) return [];
    const slot = conversationToSlot.get(selectedChatId);
    if (slot !== undefined && slot >= 0 && slot < NUM_SLOTS) {
      return (slotMessages[slot] ?? []) as UIMessage[];
    }
    return cachedMessagesByConversation[selectedChatId] ?? [];
  }, [
    selectedChatId,
    conversationToSlot,
    slotMessages,
    cachedMessagesByConversation,
  ]);

  const isSelectedChatLoading =
    Boolean(selectedChatId) &&
    (() => {
      const slot = conversationToSlot.get(selectedChatId!);
      if (slot === undefined) return false;
      const s = slotStatuses[slot];
      return s === "streaming" || s === "submitted";
    })();

  const setMessagesForConversation = useCallback(
    (convId: string, messages: UIMessage[]) => {
      if (streamingConversationIdsRef.current.has(convId)) return;
      const slot = conversationToSlot.get(convId);
      if (slot !== undefined) return;
      setCachedMessagesByConversation((prev) => ({
        ...prev,
        [convId]: messages,
      }));
      chatMessagesRef.current.set(convId, messages);
    },
    [conversationToSlot],
  );

  useEffect(() => {
    slotToConversation.forEach((convId, slot) => {
      const msgs = slotMessages[slot] as UIMessage[];
      if (msgs && msgs.length > 0) {
        setCachedMessagesByConversation((prev) =>
          prev[convId] === msgs ? prev : { ...prev, [convId]: msgs },
        );
        chatMessagesRef.current.set(convId, msgs);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotMessages ref identity; signature is stable
  }, [slotToConversation, slotMessagesSignature]);

  const getOrAssignSlot = useCallback(
    (conversationId: string): number | null => {
      const existing = conversationToSlot.get(conversationId);
      if (existing !== undefined) return existing;
      for (let i = 0; i < NUM_SLOTS; i++) {
        if (!slotToConversation.has(i)) return i;
      }
      const selectedId = selectedChatId;
      for (let i = 0; i < NUM_SLOTS; i++) {
        const convId = slotToConversation.get(i);
        if (convId && convId !== selectedId) {
          const status = slotStatuses[i];
          if (status !== "streaming" && status !== "submitted") {
            return i;
          }
        }
      }
      return null;
    },
    [conversationToSlot, slotToConversation, selectedChatId, slotStatuses],
  );

  const evictSlot = useCallback(
    (slot: number) => {
      const convId = slotToConversation.get(slot);
      if (convId === undefined) return;
      setReasoningBySlot((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      setReasoningEndedAtBySlot((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      const msgs = slotMessages[slot] as UIMessage[];
      if (msgs?.length > 0) {
        setCachedMessagesByConversation((prev) => ({
          ...prev,
          [convId]: msgs,
        }));
        chatMessagesRef.current.set(convId, msgs);
      }
      setConversationToSlot((prev) => {
        const m = new Map(prev);
        m.delete(convId);
        return m;
      });
      setSlotToConversation((prev) => {
        const m = new Map(prev);
        m.delete(slot);
        return m;
      });
      slotPayloadRef.current[slot] = { conversationId: null, model: null };
    },
    [slotToConversation, slotMessages],
  );

  useEffect(() => {
    let changed = false;
    const next: Record<number, number> = {};
    for (let slot = 0; slot < NUM_SLOTS; slot++) {
      const startedAt = reasoningStartedAtBySlotRef.current[slot];
      if (startedAt == null || reasoningEndedAtBySlot[slot] != null) continue;
      const messages = (slotMessages[slot] ?? []) as UIMessage[];
      const last = messages[messages.length - 1];
      if (!last || (last.role as string) !== "assistant") continue;
      const content = extractMessageContent(last).trim();
      if (content.length === 0) continue;
      next[slot] = Date.now();
      changed = true;
    }
    if (changed) {
      setReasoningEndedAtBySlot((prev) => ({ ...prev, ...next }));
    }
  }, [slotMessages, reasoningEndedAtBySlot]);

  const sendInConversation = useCallback(
    (conversationId: string, text: string): boolean => {
      let slot = conversationToSlot.get(conversationId);
      if (slot === undefined) {
        const freeSlot = getOrAssignSlot(conversationId);
        if (freeSlot === null) {
          toast.info(t("waitForResponses"), {
            id: "chat-slot-busy",
            duration: 3000,
          });
          return false;
        }
        const existingConv = slotToConversation.get(freeSlot);
        if (existingConv !== undefined) evictSlot(freeSlot);
        slot = freeSlot;
        slotPayloadRef.current[slot] = {
          conversationId,
          model: selectedModelRef.current,
        };
        setConversationToSlot((prev) =>
          new Map(prev).set(conversationId, slot!),
        );
        setSlotToConversation((prev) =>
          new Map(prev).set(slot!, conversationId),
        );
        const seed =
          cachedMessagesByConversation[conversationId] ??
          (chatMessagesRef.current.get(conversationId) as
            | UIMessage[]
            | undefined) ??
          [];
        setMessagesSlots[slot](
          seed as Parameters<(typeof setMessagesSlots)[0]>[0],
        );
        // Defer send until after React processes the setMessages state update
        // to ensure the slot has the correct message history
        const slotToSend = slot;
        queueMicrotask(() => {
          sendMessageSlots[slotToSend]({ text });
        });
        return true;
      }
      sendMessageSlots[slot]({ text });
      return true;
    },
    [
      conversationToSlot,
      slotToConversation,
      getOrAssignSlot,
      evictSlot,
      cachedMessagesByConversation,
      setMessagesSlots,
      sendMessageSlots,
      t,
    ],
  );

  const stopSelectedChat = useCallback(() => {
    if (!selectedChatId) return;
    const slot = conversationToSlot.get(selectedChatId);
    if (slot !== undefined) stopSlots[slot]();
  }, [selectedChatId, conversationToSlot, stopSlots]);

  const isLoading = isSelectedChatLoading;
  const isConversationLoading =
    Boolean(selectedChatId) && selectedConversation?.id !== selectedChatId;

  const selectedChatReasoningMessages = useMemo(() => {
    if (!selectedChatId) return [];
    const slot = conversationToSlot.get(selectedChatId);
    return slot !== undefined ? (reasoningBySlot[slot] ?? []) : [];
  }, [selectedChatId, conversationToSlot, reasoningBySlot]);

  const selectedChatReasoningStartedAt = useMemo(() => {
    const slot =
      selectedChatId != null
        ? conversationToSlot.get(selectedChatId)
        : undefined;
    if (slot === undefined) return null;
    const _reasoningSteps = reasoningBySlot[slot];
    return reasoningStartedAtBySlotRef.current[slot] ?? null;
  }, [selectedChatId, conversationToSlot, reasoningBySlot]);

  const selectedChatReasoningEndedAt = useMemo(() => {
    const slot =
      selectedChatId != null
        ? conversationToSlot.get(selectedChatId)
        : undefined;
    return slot !== undefined ? (reasoningEndedAtBySlot[slot] ?? null) : null;
  }, [selectedChatId, conversationToSlot, reasoningEndedAtBySlot]);

  const isSelectedChatCoworker = Boolean(
    selectedChatId &&
    ((selectedConversation?.id === selectedChatId &&
      (selectedConversation.metadata as Record<string, unknown> | null)
        ?.type === "coworker") ||
      Boolean(chats.find((c) => c.id === selectedChatId)?.coworker)),
  );

  useChatSelection({
    urlConversationId,
    pathname,
    conversations,
    selectedConversation,
    selectConversation,
    selectedChatId,
    setSelectedChatId,
    setSelectedModel,
    selectedModelRef,
    setMessages: (msgs) => {
      if (selectedChatId)
        setMessagesForConversation(selectedChatId, msgs as UIMessage[]);
    },
    setInput,
    currentChatIdRef,
    previousChatIdRef,
    isUpdatingUrlRef,
    pendingUrlConversationIdRef,
    stopStreaming: stopSelectedChat,
    isConversationsLoading,
    enabled: isRouteDriven,
  });

  const { updateChatPreview } = useChatPreview({ setChats });

  useEffect(() => {
    updateChatPreviewRef.current = updateChatPreview;
  }, [updateChatPreview]);

  const { cacheMessages: _cacheMessages, clearMessages: _clearMessages } =
    useChatMessages({
      selectedChatId,
      selectedConversation,
      setMessagesForConversation,
      previousChatIdRef,
      messagesChatIdRef,
      chatMessagesRef,
      streamingConversationIdsRef,
    });

  const { isPollingForPendingResponse, pendingResponseFailed } =
    usePendingResponsePolling({
      selectedChatId,
      displayedMessages,
      isStreaming: isSelectedChatLoading,
      setMessagesForConversation,
      refreshConversations,
    });

  const {
    createModelChat,
    createCoworkerChat,
    isWelcomeTransitioning,
    setIsWelcomeTransitioning,
    showMessagesAfterTransition,
  } = useChatCreation({
    createNewConversation,
    setChats,
    setSelectedChatId,
    setMessages: (msgs) => {
      const cid = currentChatIdRef.current;
      if (cid) setMessagesForConversation(cid, msgs as UIMessage[]);
    },
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
    navigateToConversation: isRouteDriven
      ? undefined
      : async (conversation: Conversation) => {
          onConversationCreated?.(conversation.id);
        },
  });

  useChatSync({
    conversations,
    chats,
    setChats,
    selectedChatId,
    setSelectedModel,
    selectedModelRef,
    coworkers,
  });

  const handleModelSelected = useCallback(
    async (
      model: { id: string; name: string } | null,
    ): Promise<string | null> => {
      if (!model) {
        setSelectedModel(null);
        selectedModelRef.current = null;
        return null;
      }
      const conversation = await createModelChat(model);
      return conversation?.id || null;
    },
    [createModelChat, setSelectedModel],
  );

  const handleCoworkerSelected = useCallback(
    async (coworker: Coworker): Promise<string | null> => {
      const conversation = await createCoworkerChat(coworker);
      return conversation?.id || null;
    },
    [createCoworkerChat],
  );

  const handleSendMessage = useCallback(
    async (
      messageText: string,
      coworker?: Coworker,
      model?: { id: string; name: string },
    ) => {
      if (!messageText.trim() || isLoading) return;

      const trimmedMessage = messageText.trim();

      if (!selectedChatId) {
        setIsWelcomeTransitioning(true);
        await new Promise((resolve) => setTimeout(resolve, 300));

        let conversationId: string | null = null;

        if (model || selectedModel) {
          const modelToUse = model || selectedModel;
          if (modelToUse) {
            conversationId = await handleModelSelected(modelToUse);
          }
        } else {
          const selectedCoworker =
            coworker ?? effectiveWelcomeCoworker ?? coworkers[0] ?? null;
          if (!selectedCoworker) {
            toast.error(t("noCoworkersAvailable"));
            setIsWelcomeTransitioning(false);
            return;
          }
          conversationId = await handleCoworkerSelected(selectedCoworker);
        }

        // If conversation creation failed, don't send the message
        if (!conversationId) {
          setIsWelcomeTransitioning(false);
          return;
        }

        // Verify the conversation ID was set in the ref
        if (!currentChatIdRef.current) {
          // Wait a bit more for ref to be updated, then check again
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (!currentChatIdRef.current) {
            setIsWelcomeTransitioning(false);
            return;
          }
        }

        const cid = currentChatIdRef.current ?? conversationId;
        const sent = cid ? sendInConversation(cid, trimmedMessage) : false;
        if (sent) setInput("");
        return;
      }

      if (selectedChatId) {
        const now = new Date();
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === selectedChatId
              ? {
                  ...chat,
                  updatedAt: now,
                  status: "active",
                }
              : chat,
          ),
        );
      }

      const sent = sendInConversation(selectedChatId, trimmedMessage);
      if (sent) setInput("");
    },
    [
      coworkers,
      isLoading,
      selectedChatId,
      sendInConversation,
      setInput,
      handleCoworkerSelected,
      handleModelSelected,
      selectedModel,
      effectiveWelcomeCoworker,
      t,
      setIsWelcomeTransitioning,
      currentChatIdRef,
      setChats,
    ],
  );

  const selectedChatStatus = useMemo(() => {
    if (!selectedChatId) return "ready" as const;
    const slot = conversationToSlot.get(selectedChatId);
    if (slot === undefined) return "ready" as const;
    return slotStatuses[slot];
  }, [selectedChatId, conversationToSlot, slotStatuses]);

  const sendMessageForInput = useCallback(
    (message?: { text?: string } | { parts?: unknown[] } | UIMessage) => {
      const cid = selectedChatId ?? currentChatIdRef.current;
      if (!cid) return Promise.resolve();
      const text =
        message &&
        typeof message === "object" &&
        "text" in message &&
        typeof (message as { text?: string }).text === "string"
          ? (message as { text: string }).text
          : undefined;
      if (text) sendInConversation(cid, text);
      return Promise.resolve();
    },
    [selectedChatId, sendInConversation],
  ) as UseChatHelpers<UIMessage>["sendMessage"];

  const setMessagesForInput = useCallback(
    (msgs: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => {
      if (!selectedChatId) return;
      const next =
        typeof msgs === "function"
          ? msgs(cachedMessagesByConversation[selectedChatId] ?? [])
          : msgs;
      setMessagesForConversation(selectedChatId, next);
    },
    [selectedChatId, cachedMessagesByConversation, setMessagesForConversation],
  );

  const handleResendLastMessage = useCallback(
    (text: string) => {
      if (!selectedChatId || !text.trim()) return;
      sendInConversation(selectedChatId, text.trim());
    },
    [selectedChatId, sendInConversation],
  );

  const handleStop = () => {
    stopSelectedChat();
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const selectedChatCoworker = useMemo(() => {
    if (
      selectedConversation?.id === selectedChatId &&
      selectedConversation?.metadata
    ) {
      const meta = selectedConversation.metadata as Record<string, unknown>;
      const type = meta?.type as string | undefined;
      const coworkerId = meta?.coworker_id as string | undefined;
      const coworkerSlug = meta?.coworker_slug as string | undefined;
      const coworkerName = meta?.coworker_name as string | undefined;
      if (type === "coworker" && coworkerId && coworkerName) {
        if (
          selectedChat?.coworker &&
          selectedChat.coworker.id === coworkerId &&
          selectedChat.coworker.avatar
        ) {
          return selectedChat.coworker;
        }
        const fromList = coworkers.find((c) => c.id === coworkerId);
        if (fromList) return fromList;
        if (selectedChat?.coworker?.id === coworkerId) {
          return selectedChat.coworker;
        }
        if (!coworkerSlug) {
          return selectedChat?.coworker;
        }
        return {
          id: coworkerId,
          slug: coworkerSlug,
          name: coworkerName,
          description: (meta?.coworker_description as string) ?? "",
          useCase: (meta?.coworker_useCase as string) ?? "",
        };
      }
    }
    return selectedChat?.coworker;
  }, [
    coworkers,
    selectedConversation?.id,
    selectedConversation?.metadata,
    selectedChatId,
    selectedChat?.coworker,
  ]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg">
      <div className="relative flex h-full min-h-0 w-full flex-col">
        {selectedChatId ? (
          <>
            {showMessagesAfterTransition && (
              <>
                {isConversationLoading &&
                displayedMessages.length === 0 &&
                conversationToSlot.get(selectedChatId) === undefined ? (
                  <div className="flex h-full min-h-[300px] flex-1 items-center justify-center">
                    <Loader2
                      className="text-muted-foreground size-8 animate-spin"
                      aria-hidden
                    />
                  </div>
                ) : (
                  <MessageList
                    chats={chats}
                    coworkers={coworkers}
                    isLoading={isLoading}
                    isCoworker={isSelectedChatCoworker}
                    isPollingForPendingResponse={isPollingForPendingResponse}
                    messages={displayedMessages}
                    onResendLastMessage={handleResendLastMessage}
                    pendingResponseFailed={pendingResponseFailed}
                    reasoningMessages={selectedChatReasoningMessages}
                    reasoningStartedAt={
                      selectedChatReasoningStartedAt ?? undefined
                    }
                    reasoningEndedAt={selectedChatReasoningEndedAt ?? undefined}
                    selectedChatId={selectedChatId}
                    userImageUrl={userImageUrl}
                    userName={userName}
                  />
                )}
              </>
            )}
            {!isConversationLoading && (
              <>
                <div
                  aria-hidden
                  className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-[5] h-32 bg-gradient-to-t to-transparent"
                />
                <ChatInputContainer
                  key={selectedChatId}
                  mobileKeyboardOptimized={mobileKeyboardOptimized}
                  selectedChatId={selectedChatId}
                  input={input}
                  setInput={setInput}
                  status={selectedChatStatus}
                  stop={handleStop}
                  messages={displayedMessages}
                  setMessages={setMessagesForInput}
                  sendMessage={sendMessageForInput}
                  onSendMessage={handleSendMessage}
                  selectedModel={selectedModel}
                  onSelectModel={handleModelSelected}
                  selectedChatCoworker={selectedChatCoworker}
                  coworkers={coworkers}
                />
              </>
            )}
          </>
        ) : (
          <WelcomeScreen
            mobileKeyboardOptimized={mobileKeyboardOptimized}
            showGreetingAndSuggestions={showGreetingAndSuggestions}
            userName={userName?.split(" ")[0] ?? userName}
            onSendMessage={handleSendMessage}
            isTransitioning={isWelcomeTransitioning}
            input={input}
            setInput={setInput}
            messages={[]}
            setMessages={() => {}}
            sendMessage={sendMessageForInput}
            status="ready"
            stop={handleStop}
            coworkers={coworkers}
            initialCoworker={effectiveWelcomeCoworker ?? undefined}
            onCoworkerChange={handleWelcomeCoworkerChange}
            selectedModel={welcomeSelectedModel}
            onSelectModel={handleWelcomeModelChange}
          />
        )}
      </div>
      <SelectCoworkerModal
        open={showSelectCoworkerModal}
        onOpenChange={setShowSelectCoworkerModal}
        onSelect={handleCoworkerSelected}
        coworkers={coworkers}
      />
    </div>
  );
}
