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
import { useRecoverOnTabHide } from "@/app/chat/hooks/use-recover-on-tab-hide";
import {
  convertItemsToMessages,
  deduplicateMessagesById,
  extractMessageContent,
} from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import {
  type Conversation,
  getConversationItems,
  recoverConversationResponse,
} from "@/lib/actions/conversation";

import ChatInputContainer from "./chat-input-container";
import MessageList from "./message-list";
import SelectCoworkerModal from "./select-coworker-modal";
import WelcomeScreen from "./welcome-screen";

const NUM_SLOTS = 3;
const RECOVERY_POLL_INTERVAL_MS = 2500;
const RECOVERY_POLL_TIMEOUT_MS = 90_000;

interface SlotPayload {
  conversationId: string | null;
  model: { id: string; name: string } | null;
}

function readPreviousResponseIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const p = metadata?.previous_response_id;
  return typeof p === "string" && p.trim().length > 0 ? p.trim() : undefined;
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
  const conversationIdFromPath = useMemo(() => {
    if (!pathname?.startsWith("/chat")) return null;
    const segments = pathname.split("/").filter(Boolean);
    if (
      segments[0] !== "chat" ||
      segments[2] !== "conversation" ||
      !segments[3]
    )
      return null;
    return segments[3] ?? null;
  }, [pathname]);
  const urlConversationId = isRouteDriven
    ? (params?.conversationId ?? conversationIdFromPath ?? null)
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

  const conversationsForChatRequestRef = useRef(conversations);
  conversationsForChatRequestRef.current = conversations;
  const selectedConversationForChatRequestRef = useRef(selectedConversation);
  selectedConversationForChatRequestRef.current = selectedConversation;
  const resendPreviousResponseIdOverrideRef = useRef(new Map<string, string>());

  const [chats, setChats] = useState<Chat[]>([]);
  const [input, setInput] = useState<string>("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRecoveringPolling, setIsRecoveringPolling] = useState(false);
  const [
    recoveryNotFoundForConversationId,
    setRecoveryNotFoundForConversationId,
  ] = useState<string | null>(null);
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    urlConversationId || null,
  );

  useEffect(() => {
    if (!isRouteDriven || !urlConversationId) return;
    if (selectedChatId === urlConversationId) return;
    setSelectedChatId(urlConversationId);
  }, [isRouteDriven, urlConversationId, selectedChatId]);

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

    const urlHasConversation =
      urlConversationId && selectedChatId !== urlConversationId;
    const willSync = urlHasConversation && urlIdInList;
    const willSyncFromUrlOnly =
      urlHasConversation && !urlIdInList && conversations.length > 0;
    const pending = pendingUrlConversationIdRef.current;
    let pendingFromStorage: string | null = null;
    try {
      pendingFromStorage = sessionStorage.getItem(
        PENDING_CONVERSATION_STORAGE_KEY,
      );
    } catch {}
    const skipSync =
      (willSync || willSyncFromUrlOnly) &&
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
    if ((willSync || willSyncFromUrlOnly) && !skipSync) {
      setSelectedChatId(urlConversationId);
    }
  }, [
    isRouteDriven,
    urlConversationId,
    selectedChatId,
    urlIdInList,
    conversations.length,
  ]);

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
  const [reasoningStartedAtBySlot, setReasoningStartedAtBySlot] = useState<
    Record<number, number>
  >({});
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
        setReasoningStartedAtBySlot((prev) => {
          const next = { ...prev };
          delete next[slotIndex];
          return next;
        });
        const payload = slotPayloadRef.current[slotIndex];
        const cid = payload?.conversationId;
        let previousResponseIdForBody: string | undefined;
        if (typeof cid === "string" && cid.length > 0) {
          const override = resendPreviousResponseIdOverrideRef.current.get(cid);
          if (override) {
            previousResponseIdForBody = override;
            resendPreviousResponseIdOverrideRef.current.delete(cid);
          } else {
            const sel = selectedConversationForChatRequestRef.current;
            if (sel?.id === cid) {
              previousResponseIdForBody = readPreviousResponseIdFromMetadata(
                sel.metadata as Record<string, unknown> | null,
              );
            }
            if (!previousResponseIdForBody) {
              const conv = conversationsForChatRequestRef.current.find(
                (c) => c.id === cid,
              );
              previousResponseIdForBody = readPreviousResponseIdFromMetadata(
                conv?.metadata as Record<string, unknown> | null,
              );
            }
          }
        }
        return {
          body: {
            messages: request.messages,
            ...(payload?.conversationId
              ? { conversationId: payload.conversationId }
              : {}),
            ...(payload?.model ? { model: payload.model.id } : {}),
            ...request.body,
            ...(previousResponseIdForBody
              ? { previousResponseId: previousResponseIdForBody }
              : {}),
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
        const existingIndex = list.findIndex((r) => r.id === id);
        const nextList =
          existingIndex >= 0
            ? list.map((r, i) => (i === existingIndex ? { ...r, message } : r))
            : [...list, { id, message }];
        return { ...prev, [slotIndex]: nextList };
      });
    };
  }, []);

  const onErrorForSlot = useCallback(
    (slotIndex: number) => (error: unknown) => {
      console.error(`Chat API error (slot ${slotIndex}):`, error);
      const convId = slotPayloadRef.current[slotIndex]?.conversationId ?? null;
      if (convId) void selectConversation(convId);
    },
    [selectConversation],
  );

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
    onError: onErrorForSlot(0),
    onFinish: onFinishForSlot(0),
  });
  const chat1 = useChat({
    transport: transport1,
    onData: onDataForSlot(1),
    onError: onErrorForSlot(1),
    onFinish: onFinishForSlot(1),
  });
  const chat2 = useChat({
    transport: transport2,
    onData: onDataForSlot(2),
    onError: onErrorForSlot(2),
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

  const refetchedForEmptyAssistantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChatId || isSelectedChatLoading) {
      return;
    }
    const slot = conversationToSlot.get(selectedChatId);
    if (slot === undefined) return;
    const msgs = (slotMessages[slot] ?? []) as UIMessage[];
    const last = msgs[msgs.length - 1];
    const lastContent =
      last?.role === "assistant" ? extractMessageContent(last).trim() : "";
    const emptyAssistantEnd =
      last?.role === "assistant" && lastContent === "" && msgs.length > 0;
    if (!emptyAssistantEnd) {
      refetchedForEmptyAssistantRef.current = null;
      return;
    }
    if (refetchedForEmptyAssistantRef.current === selectedChatId) return;
    refetchedForEmptyAssistantRef.current = selectedChatId;
    void selectConversation(selectedChatId);
  }, [
    selectedChatId,
    conversationToSlot,
    slotMessages,
    isSelectedChatLoading,
    selectConversation,
  ]);

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
      setReasoningStartedAtBySlot((prev) => {
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

  useLayoutEffect(() => {
    const now = Date.now();
    const effectiveStarted: Record<number, number> = {
      ...reasoningStartedAtBySlot,
    };
    let needPersistStarted = false;
    for (let slot = 0; slot < NUM_SLOTS; slot++) {
      const steps = reasoningBySlot[slot];
      if (steps && steps.length > 0 && effectiveStarted[slot] == null) {
        effectiveStarted[slot] = now;
        needPersistStarted = true;
      }
    }
    if (needPersistStarted) {
      setReasoningStartedAtBySlot(effectiveStarted);
    }

    const nextEnded: Record<number, number> = {};
    let needEnded = false;
    for (let slot = 0; slot < NUM_SLOTS; slot++) {
      const startedAt = effectiveStarted[slot];
      if (startedAt == null || reasoningEndedAtBySlot[slot] != null) continue;
      const messages = (slotMessages[slot] ?? []) as UIMessage[];
      const last = messages[messages.length - 1];
      if (!last || (last.role as string) !== "assistant") continue;
      const content = extractMessageContent(last).trim();
      if (content.length === 0) continue;
      nextEnded[slot] = now;
      needEnded = true;
    }
    if (needEnded) {
      setReasoningEndedAtBySlot((prev) => ({ ...prev, ...nextEnded }));
    }
  }, [
    reasoningBySlot,
    slotMessages,
    reasoningEndedAtBySlot,
    reasoningStartedAtBySlot,
  ]);

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
    return reasoningStartedAtBySlot[slot] ?? null;
  }, [selectedChatId, conversationToSlot, reasoningStartedAtBySlot]);

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

  const conversationForRecovery =
    selectedConversation?.id === selectedChatId
      ? selectedConversation
      : selectedChatId
        ? (conversations.find((c) => c.id === selectedChatId) ?? null)
        : null;
  const hasPendingIdInMetadata = Boolean(
    selectedChatId &&
      conversationForRecovery &&
      (() => {
        const meta = (conversationForRecovery.metadata ?? {}) as Record<
          string,
          unknown
        >;
        const id = meta.pending_responses_api_response_id;
        return typeof id === "string" && id.length > 0;
      })(),
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
      skipLoadWhenPendingId: hasPendingIdInMetadata,
      setMessagesForConversation,
      previousChatIdRef,
      messagesChatIdRef,
      chatMessagesRef,
      streamingConversationIdsRef,
    });

  const {
    isPollingForPendingResponse,
    pendingResponseFailed,
    clearPendingResponseFailed,
  } = usePendingResponsePolling({
    selectedChatId,
    displayedMessages,
    isStreaming: isSelectedChatLoading,
    hasPendingIdInMetadata,
    setMessagesForConversation,
    refreshConversations,
  });

  const recoveryAttemptedForRef = useRef<string | null>(null);
  const recoveredProcessedForRef = useRef<string | null>(null);
  const currentCidRef = useRef<string | null>(null);
  const conversationRecoveryGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  currentCidRef.current = urlConversationId ?? selectedChatId ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function convHasPendingId(conv: { metadata?: unknown } | null): boolean {
    if (!conv) return false;
    const meta = (conv.metadata ?? {}) as Record<string, unknown>;
    const id = meta.pending_responses_api_response_id;
    return typeof id === "string" && id.length > 0;
  }

  useEffect(() => {
    const cid = urlConversationId ?? selectedChatId;
    if (!cid || !isRouteDriven || !isChatPath) {
      return;
    }
    if (conversationToSlot.get(cid) !== undefined) {
      return;
    }

    const convForCid =
      (conversationForRecovery?.id === cid ? conversationForRecovery : null) ??
      conversations.find((c) => c.id === cid) ??
      null;
    const cidHasPendingId = convHasPendingId(convForCid);

    if (recoveryAttemptedForRef.current === cid) {
      // Don't re-set recovering when we already processed recovery (stale sidebar metadata).
      if (
        cidHasPendingId &&
        mountedRef.current &&
        recoveredProcessedForRef.current !== cid
      ) {
        setIsRecovering(true);
        setIsRecoveringPolling(true);
      }
      return;
    }
    recoveryAttemptedForRef.current = cid;
    const routeRecoveryGeneration = conversationRecoveryGenerationRef.current;
    if (urlConversationId && selectedChatId !== urlConversationId) {
      setSelectedChatId(urlConversationId);
    }
    if (cidHasPendingId) {
      setIsRecovering(true);
      setIsRecoveringPolling(true);
    }
    (async () => {
      const isCancelled = () =>
        routeRecoveryGeneration !== conversationRecoveryGenerationRef.current;
      async function loadConversationItemsIntoCache(conversationId: string) {
        const itemsResult = await getConversationItems({
          conversationId,
          limit: 100,
        });
        if (isCancelled()) return;
        const itemsPayload =
          itemsResult &&
          typeof itemsResult === "object" &&
          "ok" in itemsResult &&
          itemsResult.ok
            ? (itemsResult as { data?: { items?: unknown[] } }).data
            : itemsResult &&
                typeof itemsResult === "object" &&
                "value" in itemsResult
              ? (itemsResult as { value?: { items?: unknown[] } }).value
              : undefined;
        if (
          itemsPayload &&
          Array.isArray(itemsPayload.items) &&
          mountedRef.current
        ) {
          const msgs = convertItemsToMessages(
            itemsPayload.items as Array<{
              id: string;
              role: string;
              content: Array<{ type: string; text?: string }> | string;
              createdAt: number;
            }>,
          );
          setMessagesForConversation(conversationId, msgs);
          chatMessagesRef.current.set(conversationId, msgs);
        }
      }
      function parseRecoverPayload(result: unknown) {
        if (!result || typeof result !== "object") return undefined;
        const data =
          "ok" in result && result.ok && "data" in result
            ? (
                result as {
                  data?: {
                    recovered?: boolean;
                    reason?: "not_found" | "in_progress" | "terminal";
                  };
                }
              ).data
            : "value" in result
              ? (
                  result as {
                    value?: {
                      recovered?: boolean;
                      reason?: "not_found" | "in_progress" | "terminal";
                    };
                  }
                ).value
              : undefined;
        return data;
      }
      try {
        await loadConversationItemsIntoCache(cid);
        if (isCancelled()) return;
        const result = await recoverConversationResponse({
          conversationId: cid,
        });
        if (isCancelled()) return;
        const recoverPayload = parseRecoverPayload(result);
        if (!recoverPayload?.recovered) {
          if (
            recoverPayload?.reason === "not_found" ||
            recoverPayload?.reason === "terminal"
          ) {
            if (mountedRef.current) setRecoveryNotFoundForConversationId(cid);
            return;
          }
          if (recoverPayload?.reason === "in_progress") {
            if (mountedRef.current) {
              setIsRecovering(true);
              setIsRecoveringPolling(true);
            }
            const startTime = Date.now();
            for (;;) {
              await new Promise((r) =>
                setTimeout(r, RECOVERY_POLL_INTERVAL_MS),
              );
              if (isCancelled()) break;
              if (Date.now() - startTime > RECOVERY_POLL_TIMEOUT_MS) {
                if (mountedRef.current) {
                  setRecoveryNotFoundForConversationId(cid);
                  setIsRecoveringPolling(false);
                  setIsRecovering(false);
                }
                return;
              }
              const pollResult = await recoverConversationResponse({
                conversationId: cid,
              });
              if (isCancelled()) return;
              const pollPayload = parseRecoverPayload(pollResult);
              if (pollPayload?.recovered) {
                if (recoveredProcessedForRef.current !== cid) {
                  recoveredProcessedForRef.current = cid;
                  const itemsResult = await getConversationItems({
                    conversationId: cid,
                    limit: 100,
                  });
                  if (isCancelled()) return;
                  const itemsPayload =
                    itemsResult &&
                    typeof itemsResult === "object" &&
                    "ok" in itemsResult &&
                    itemsResult.ok
                      ? (itemsResult as { data?: { items?: unknown[] } }).data
                      : itemsResult &&
                          typeof itemsResult === "object" &&
                          "value" in itemsResult
                        ? (itemsResult as { value?: { items?: unknown[] } })
                            .value
                        : undefined;
                  if (
                    itemsPayload &&
                    Array.isArray(itemsPayload.items) &&
                    mountedRef.current
                  ) {
                    const newMessages = deduplicateMessagesById(
                      convertItemsToMessages(
                        itemsPayload.items as Array<{
                          id: string;
                          role: string;
                          content:
                            | Array<{ type: string; text?: string }>
                            | string;
                          createdAt: number;
                        }>,
                      ),
                    );
                    setMessagesForConversation(cid, newMessages);
                    chatMessagesRef.current.set(cid, newMessages);
                    const slot = conversationToSlot.get(cid);
                    if (
                      typeof slot === "number" &&
                      slot >= 0 &&
                      slot < NUM_SLOTS &&
                      setMessagesSlots[slot]
                    ) {
                      setMessagesSlots[slot](newMessages);
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
                      setReasoningStartedAtBySlot((prev) => {
                        const next = { ...prev };
                        delete next[slot];
                        return next;
                      });
                    }
                    if (mountedRef.current) {
                      setIsRecoveringPolling(false);
                      setIsRecovering(false);
                    }
                    await refreshConversations();
                  }
                }
                if (mountedRef.current) {
                  setIsRecoveringPolling(false);
                  setIsRecovering(false);
                }
                return;
              }
              if (
                pollPayload?.reason === "not_found" ||
                pollPayload?.reason === "terminal"
              ) {
                if (mountedRef.current) {
                  setRecoveryNotFoundForConversationId(cid);
                  setIsRecoveringPolling(false);
                  setIsRecovering(false);
                }
                return;
              }
            }
            if (mountedRef.current) {
              setIsRecoveringPolling(false);
              setIsRecovering(false);
            }
            return;
          }
          if (mountedRef.current) setIsRecovering(false);
          return;
        }
        if (recoveredProcessedForRef.current !== cid) {
          recoveredProcessedForRef.current = cid;
          const itemsResult = await getConversationItems({
            conversationId: cid,
            limit: 100,
          });
          if (isCancelled()) return;
          const itemsPayload =
            itemsResult &&
            typeof itemsResult === "object" &&
            "ok" in itemsResult &&
            itemsResult.ok
              ? (itemsResult as { data?: { items?: unknown[] } }).data
              : itemsResult &&
                  typeof itemsResult === "object" &&
                  "value" in itemsResult
                ? (itemsResult as { value?: { items?: unknown[] } }).value
                : undefined;
          if (
            itemsPayload &&
            Array.isArray(itemsPayload.items) &&
            mountedRef.current
          ) {
            const newMessages = deduplicateMessagesById(
              convertItemsToMessages(
                itemsPayload.items as Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  createdAt: number;
                }>,
              ),
            );
            setMessagesForConversation(cid, newMessages);
            chatMessagesRef.current.set(cid, newMessages);
            const slot = conversationToSlot.get(cid);
            if (
              typeof slot === "number" &&
              slot >= 0 &&
              slot < NUM_SLOTS &&
              setMessagesSlots[slot]
            ) {
              setMessagesSlots[slot](newMessages);
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
              setReasoningStartedAtBySlot((prev) => {
                const next = { ...prev };
                delete next[slot];
                return next;
              });
            }
            if (mountedRef.current) {
              setIsRecoveringPolling(false);
              setIsRecovering(false);
            }
            await refreshConversations();
          }
        }
      } catch (_err) {
        if (mountedRef.current && !isCancelled()) setIsRecovering(false);
      } finally {
        if (mountedRef.current && !isCancelled()) {
          setIsRecoveringPolling(false);
          setIsRecovering(false);
        }
      }
    })();
    return () => {
      conversationRecoveryGenerationRef.current += 1;
      setIsRecoveringPolling(false);
      setIsRecovering(false);
    };
  }, [
    urlConversationId,
    selectedChatId,
    isRouteDriven,
    isChatPath,
    conversationToSlot,
    setMessagesForConversation,
    setMessagesSlots,
    refreshConversations,
    conversationForRecovery,
    conversations,
  ]);

  useEffect(() => {
    const conv = conversationForRecovery;
    const cid = selectedChatId;
    if (!conv?.id || conv.id !== cid) return;
    const meta = (conv.metadata as Record<string, unknown> | null) ?? null;
    const isCoworker =
      meta?.type === "coworker" ||
      (typeof meta?.coworker_id === "string" && meta.coworker_id.length > 0) ||
      (typeof meta?.coworker_slug === "string" &&
        meta.coworker_slug.length > 0);
    if (!isCoworker) return;

    const pendingId = meta?.pending_responses_api_response_id;
    if (typeof pendingId !== "string" || pendingId.length === 0) return;

    if (recoveryAttemptedForRef.current === conv.id) {
      if (mountedRef.current && recoveredProcessedForRef.current !== conv.id) {
        setIsRecovering(true);
        setIsRecoveringPolling(true);
      }
      return;
    }

    recoveryAttemptedForRef.current = conv.id;

    const recoveryGeneration = conversationRecoveryGenerationRef.current;

    setIsRecovering(true);
    setIsRecoveringPolling(true);
    let cancelled = false;
    function isAborted() {
      return (
        cancelled ||
        recoveryGeneration !== conversationRecoveryGenerationRef.current
      );
    }
    (async () => {
      async function loadConversationItemsIntoCache(conversationId: string) {
        const itemsResult = await getConversationItems({
          conversationId,
          limit: 100,
        });
        if (isAborted()) return;
        const itemsPayload =
          itemsResult &&
          typeof itemsResult === "object" &&
          "ok" in itemsResult &&
          itemsResult.ok
            ? (itemsResult as { data?: { items?: unknown[] } }).data
            : itemsResult &&
                typeof itemsResult === "object" &&
                "value" in itemsResult
              ? (itemsResult as { value?: { items?: unknown[] } }).value
              : undefined;
        if (itemsPayload && Array.isArray(itemsPayload.items)) {
          const msgs = convertItemsToMessages(
            itemsPayload.items as Array<{
              id: string;
              role: string;
              content: Array<{ type: string; text?: string }> | string;
              createdAt: number;
            }>,
          );
          setMessagesForConversation(conversationId, msgs);
          chatMessagesRef.current.set(conversationId, msgs);
        }
      }
      function parseRecoverPayload(result: unknown) {
        if (!result || typeof result !== "object") return undefined;
        const data =
          "ok" in result && result.ok && "data" in result
            ? (
                result as {
                  data?: {
                    recovered?: boolean;
                    reason?: "not_found" | "in_progress" | "terminal";
                  };
                }
              ).data
            : "value" in result
              ? (
                  result as {
                    value?: {
                      recovered?: boolean;
                      reason?: "not_found" | "in_progress" | "terminal";
                    };
                  }
                ).value
              : undefined;
        return data;
      }
      try {
        await loadConversationItemsIntoCache(conv.id);
        if (isAborted()) return;
        const result = await recoverConversationResponse({
          conversationId: conv.id,
        });
        if (isAborted()) return;
        const recoverPayload = parseRecoverPayload(result);
        if (!recoverPayload?.recovered) {
          if (
            recoverPayload?.reason === "not_found" ||
            recoverPayload?.reason === "terminal"
          ) {
            setRecoveryNotFoundForConversationId(conv.id);
            setIsRecovering(false);
            return;
          }
          if (recoverPayload?.reason === "in_progress") {
            setIsRecovering(true);
            setIsRecoveringPolling(true);
            const startTime = Date.now();
            for (;;) {
              await new Promise((r) =>
                setTimeout(r, RECOVERY_POLL_INTERVAL_MS),
              );
              if (isAborted()) break;
              if (Date.now() - startTime > RECOVERY_POLL_TIMEOUT_MS) {
                setRecoveryNotFoundForConversationId(conv.id);
                setIsRecoveringPolling(false);
                setIsRecovering(false);
                return;
              }
              const pollResult = await recoverConversationResponse({
                conversationId: conv.id,
              });
              if (isAborted()) return;
              const pollPayload = parseRecoverPayload(pollResult);
              if (pollPayload?.recovered) {
                if (recoveredProcessedForRef.current !== conv.id) {
                  recoveredProcessedForRef.current = conv.id;
                  const itemsResult = await getConversationItems({
                    conversationId: conv.id,
                    limit: 100,
                  });
                  if (isAborted()) return;
                  const itemsPayload =
                    itemsResult &&
                    typeof itemsResult === "object" &&
                    "ok" in itemsResult &&
                    itemsResult.ok
                      ? (itemsResult as { data?: { items?: unknown[] } }).data
                      : itemsResult &&
                          typeof itemsResult === "object" &&
                          "value" in itemsResult
                        ? (itemsResult as { value?: { items?: unknown[] } })
                            .value
                        : undefined;
                  if (itemsPayload && Array.isArray(itemsPayload.items)) {
                    const newMessages = deduplicateMessagesById(
                      convertItemsToMessages(
                        itemsPayload.items as Array<{
                          id: string;
                          role: string;
                          content:
                            | Array<{ type: string; text?: string }>
                            | string;
                          createdAt: number;
                        }>,
                      ),
                    );
                    setMessagesForConversation(conv.id, newMessages);
                    chatMessagesRef.current.set(conv.id, newMessages);
                    const slot = conversationToSlot.get(conv.id);
                    if (
                      typeof slot === "number" &&
                      slot >= 0 &&
                      slot < NUM_SLOTS &&
                      setMessagesSlots[slot]
                    ) {
                      setMessagesSlots[slot](newMessages);
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
                      setReasoningStartedAtBySlot((prev) => {
                        const next = { ...prev };
                        delete next[slot];
                        return next;
                      });
                    }
                    setIsRecoveringPolling(false);
                    setIsRecovering(false);
                    await refreshConversations();
                  }
                }
                setIsRecoveringPolling(false);
                setIsRecovering(false);
                return;
              }
              if (
                pollPayload?.reason === "not_found" ||
                pollPayload?.reason === "terminal"
              ) {
                setRecoveryNotFoundForConversationId(conv.id);
                setIsRecoveringPolling(false);
                setIsRecovering(false);
                return;
              }
            }
            setIsRecoveringPolling(false);
            setIsRecovering(false);
            return;
          }
          setIsRecovering(false);
          return;
        }
        if (recoveredProcessedForRef.current !== conv.id) {
          recoveredProcessedForRef.current = conv.id;
          const itemsResult = await getConversationItems({
            conversationId: conv.id,
            limit: 100,
          });
          if (isAborted()) return;
          const itemsPayload =
            itemsResult &&
            typeof itemsResult === "object" &&
            "ok" in itemsResult &&
            itemsResult.ok
              ? (itemsResult as { data?: { items?: unknown[] } }).data
              : itemsResult &&
                  typeof itemsResult === "object" &&
                  "value" in itemsResult
                ? (itemsResult as { value?: { items?: unknown[] } }).value
                : undefined;
          if (itemsPayload && Array.isArray(itemsPayload.items)) {
            const newMessages = deduplicateMessagesById(
              convertItemsToMessages(
                itemsPayload.items as Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  createdAt: number;
                }>,
              ),
            );
            setMessagesForConversation(conv.id, newMessages);
            chatMessagesRef.current.set(conv.id, newMessages);
            const slot = conversationToSlot.get(conv.id);
            if (
              typeof slot === "number" &&
              slot >= 0 &&
              slot < NUM_SLOTS &&
              setMessagesSlots[slot]
            ) {
              setMessagesSlots[slot](newMessages);
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
              setReasoningStartedAtBySlot((prev) => {
                const next = { ...prev };
                delete next[slot];
                return next;
              });
            }
            setIsRecoveringPolling(false);
            setIsRecovering(false);
            await refreshConversations();
          }
        }
      } catch (_) {
        if (!isAborted()) setIsRecovering(false);
      } finally {
        if (!isAborted()) {
          setIsRecoveringPolling(false);
          setIsRecovering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      conversationRecoveryGenerationRef.current += 1;
      if (recoveryAttemptedForRef.current === conv.id) {
        recoveryAttemptedForRef.current = null;
      }
      setIsRecoveringPolling(false);
      setIsRecovering(false);
    };
  }, [
    conversationForRecovery,
    selectedChatId,
    setMessagesForConversation,
    refreshConversations,
    conversationToSlot,
    setMessagesSlots,
  ]);

  useRecoverOnTabHide({
    selectedConversation,
    selectedChatId,
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
    async (text: string) => {
      if (!selectedChatId || !text.trim()) return;
      setRecoveryNotFoundForConversationId((prev) =>
        prev === selectedChatId ? null : prev,
      );
      clearPendingResponseFailed();
      const list = await refreshConversations();
      const conv = list?.find((c) => c.id === selectedChatId);
      const pid = readPreviousResponseIdFromMetadata(
        conv?.metadata as Record<string, unknown> | null,
      );
      if (pid) {
        resendPreviousResponseIdOverrideRef.current.set(selectedChatId, pid);
      }
      sendInConversation(selectedChatId, text.trim());
    },
    [
      selectedChatId,
      sendInConversation,
      clearPendingResponseFailed,
      refreshConversations,
    ],
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
                {(!isRecovering &&
                  hasPendingIdInMetadata &&
                  displayedMessages.length === 0 &&
                  conversationToSlot.get(selectedChatId) === undefined) ||
                (!isRecovering &&
                  isConversationLoading &&
                  displayedMessages.length === 0 &&
                  conversationToSlot.get(selectedChatId) === undefined) ? (
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
                    conversationCoworkerFallback={
                      selectedChatCoworker
                        ? {
                            id: selectedChatCoworker.id,
                            name: selectedChatCoworker.name,
                            avatar: selectedChatCoworker.avatar,
                          }
                        : null
                    }
                    hasPendingIdInMetadata={hasPendingIdInMetadata}
                    isLoading={isLoading}
                    isCoworker={isSelectedChatCoworker}
                    isRecovering={isRecovering}
                    isRecoveringPolling={isRecoveringPolling}
                    isRecoveryNotFound={
                      recoveryNotFoundForConversationId === selectedChatId
                    }
                    isPollingForPendingResponse={isPollingForPendingResponse}
                    messages={displayedMessages}
                    onResendLastMessage={handleResendLastMessage}
                    pendingResponseFailed={
                      pendingResponseFailed ||
                      recoveryNotFoundForConversationId === selectedChatId
                    }
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
            {!isConversationLoading &&
              !isRecovering &&
              !(
                hasPendingIdInMetadata &&
                displayedMessages.length === 0 &&
                conversationToSlot.get(selectedChatId) === undefined
              ) && (
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
