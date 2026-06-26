"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { Loader2 } from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
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
import ChatInputContainer from "@/app/chat/components/chat-input-container";
import SelectCoworkerModal from "@/app/chat/components/select-coworker-modal";
import WelcomeScreen from "@/app/chat/components/welcome-screen";
import { useChatMessages } from "@/app/chat/hooks/use-chat-messages";
import { useChatPreview } from "@/app/chat/hooks/use-chat-preview";
import { useChatSync } from "@/app/chat/hooks/use-chat-sync";
import { useCoworkerPostRefreshAssistantPoll } from "@/app/chat/hooks/use-coworker-post-refresh-assistant-poll";
import {
  coworkerHasCapability,
  filterCoworkersForComposeKind,
  findCoworkerBySlugOrId,
  findDefaultCoworker,
} from "@/app/chat/utils/coworker-utils";
import type {
  Chat,
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  ChatSendMessage,
  Coworker,
} from "@/app/chat/utils/types";
import {
  buildWelcomeComposeStoredSnapshot,
  readWelcomeComposePreferences,
  resolveHydratedWelcomeSelection,
  writeWelcomeComposePreferences,
} from "@/app/chat/utils/welcome-compose-preferences";
import { useChatCreation } from "@/app/chat-ui/hooks/use-chat-creation";
import { useChatSelection } from "@/app/chat-ui/hooks/use-chat-selection";
import {
  CHAT_API_PATH,
  getConversationIdFromChatPathname,
  getPendingConversationStorageKey,
  isChatShellPathname,
} from "@/app/chat-ui/utils/chat-route-base";
import {
  hasImageGenerationUiMessage,
  readActiveUiStreamIdFromMetadata,
  readConversationImageGenerationFromMetadata,
} from "@/app/chat-ui/utils/conversation-metadata";
import {
  extractMessageContent,
  extractReasoningStepMessages,
  hasMessageTextOrFileParts,
  mergeAssistantThoughtMetadataFromDb,
} from "@/app/chat-ui/utils/message-utils";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { Conversation } from "@/lib/actions/conversation";
import type { TaskDesignMdAttachmentSeed } from "@/lib/utils/task-attachments";

import MessageList from "./message-list";

const NUM_SLOTS = 3;

const SLOT_PLACEHOLDER_CHAT_IDS: readonly [string, string, string] = [
  "__sokosumi_empty_slot_0__",
  "__sokosumi_empty_slot_1__",
  "__sokosumi_empty_slot_2__",
];

/** Matches Postgres `uuid` / Prisma `@default(uuid(7))` etc. (RFC 4122 / RFC 9562 shape). */
const CONVERSATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isConversationUuid(value: string): boolean {
  return CONVERSATION_UUID_RE.test(value.trim());
}

const CHAT_NO_RESUMABLE_STREAM_PATH = "/api/chat/no-resumable-stream";

/** Stable no-op for inputs that do not wire `useChat` stop; avoids breaking memo equality on `stop`. */
function noopChatComposerStop() {}

function getSendMessageText(message: ChatComposeMessage): string {
  if (typeof message === "string") return message.trim();
  return extractMessageContent(message).trim();
}

function hasSendMessageContent(message: ChatComposeMessage): boolean {
  if (getSendMessageText(message).length > 0) return true;
  return typeof message === "string"
    ? false
    : hasMessageTextOrFileParts(message);
}

function toChatSendMessage(message: ChatComposeMessage): ChatSendMessage {
  if (typeof message === "string") {
    return { text: message.trim() } as ChatSendMessage;
  }

  const m = message as Record<string, unknown>;
  const hasText = typeof m.text === "string";
  const hasParts = Array.isArray(m.parts);
  if (!hasText && !hasParts) {
    return message;
  }

  const next: Record<string, unknown> = { ...m };
  if (hasText) {
    next.text = (m.text as string).trim();
  }
  if (hasParts) {
    next.parts = (m.parts as unknown[]).map((part: unknown) => {
      if (!part || typeof part !== "object") return part;
      const p = part as Record<string, unknown>;
      if (p.type !== "text") return part;
      if (typeof p.text === "string") return { ...p, text: p.text.trim() };
      if (typeof p.content === "string") {
        return { ...p, content: p.content.trim() };
      }
      return part;
    });
  }

  return next as ChatSendMessage;
}

function buildResendMessage(message: UIMessage): ChatSendMessage | null {
  if (hasMessageTextOrFileParts(message)) {
    return { parts: message.parts } as ChatSendMessage;
  }

  const text = extractMessageContent(message).trim();
  return text ? ({ text } as ChatSendMessage) : null;
}

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

function readImageGenerationFromMessage(message: UIMessage): boolean {
  const metadata = (message as { metadata?: unknown }).metadata;
  return (
    metadata != null &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>).imageGeneration === true
  );
}

function withImageGenerationMetadata(
  message: ChatSendMessage,
  imageGeneration: boolean,
): ChatSendMessage {
  if (!imageGeneration || typeof message !== "object" || message == null) {
    return message;
  }

  const record = message as Record<string, unknown>;
  const metadata =
    record.metadata != null && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : {};

  return {
    ...record,
    metadata: {
      ...metadata,
      imageGeneration: true,
    },
  } as ChatSendMessage;
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
  initialDesignMdAttachment?: TaskDesignMdAttachmentSeed | null;
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
  initialDesignMdAttachment = null,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Chat.Chat");
  const params = useParams<{ conversationId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isRouteDriven = navigationMode === "route";
  const isChatPath = useMemo(() => isChatShellPathname(pathname), [pathname]);
  const conversationIdFromPath = useMemo(() => {
    if (!pathname) return null;
    return getConversationIdFromChatPathname(pathname);
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
  const hydratedRouteConversationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChatId) return;
    if (isRouteDriven && !isChatPath) return;
    const routeConversationKey =
      isRouteDriven && isChatPath
        ? `${pathname ?? ""}:${selectedChatId}`
        : null;
    const needsRouteHydration =
      routeConversationKey !== null &&
      hydratedRouteConversationKeyRef.current !== routeConversationKey;
    if (selectedConversation?.id === selectedChatId && !needsRouteHydration) {
      return;
    }
    if (
      loadingConversationIdRef.current === selectedChatId &&
      !needsRouteHydration
    ) {
      return;
    }
    if (needsRouteHydration) {
      hydratedRouteConversationKeyRef.current = routeConversationKey;
    }
    loadingConversationIdRef.current = selectedChatId;
    void selectConversation(selectedChatId).finally(() => {
      if (loadingConversationIdRef.current === selectedChatId) {
        loadingConversationIdRef.current = null;
      }
    });
  }, [
    isChatPath,
    isRouteDriven,
    pathname,
    selectedChatId,
    selectedConversation?.id,
    selectConversation,
  ]);

  const { coworkers } = useCoworkersContext();

  const welcomeCoworkerSlug = searchParams?.get("coworker") ?? null;
  const initialWelcomeCoworker = useMemo(() => {
    if (welcomeCoworkerSlug) {
      return findCoworkerBySlugOrId(coworkers, welcomeCoworkerSlug);
    }
    return findDefaultCoworker(
      filterCoworkersForComposeKind(coworkers, "chat"),
    );
  }, [coworkers, welcomeCoworkerSlug]);

  const [welcomeSelectedCoworker, setWelcomeSelectedCoworker] =
    useState<Coworker | null>(null);
  const [welcomeSelectedModel, setWelcomeSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const effectiveWelcomeCoworker = useMemo(() => {
    if (welcomeSelectedModel != null) {
      return null;
    }
    const candidate =
      welcomeCoworkerSlug != null
        ? initialWelcomeCoworker
        : (welcomeSelectedCoworker ?? initialWelcomeCoworker);
    if (!candidate) {
      return null;
    }
    return coworkerHasCapability(candidate, "chat") ? candidate : null;
  }, [
    initialWelcomeCoworker,
    welcomeCoworkerSlug,
    welcomeSelectedCoworker,
    welcomeSelectedModel,
  ]);

  const [isWelcomeSubmitting, setIsWelcomeSubmitting] = useState(false);
  const welcomeCreationInFlightRef = useRef(false);

  const welcomePrefsHydratedRef = useRef(false);
  const previousWelcomeCoworkerSlugRef = useRef<string | null>(
    welcomeCoworkerSlug,
  );
  const welcomeSelectedCoworkerRef = useRef<Coworker | null>(null);
  const welcomeSelectedModelRef = useRef<{
    id: string;
    name: string;
  } | null>(null);
  const welcomePrefsWriteSelectedChatIdRef = useRef<string | null>(null);
  const welcomePrefsWriteWelcomeCoworkerSlugRef = useRef<string | null>(null);
  welcomeSelectedCoworkerRef.current = welcomeSelectedCoworker;
  welcomeSelectedModelRef.current = welcomeSelectedModel;
  welcomePrefsWriteSelectedChatIdRef.current = selectedChatId;
  welcomePrefsWriteWelcomeCoworkerSlugRef.current = welcomeCoworkerSlug;

  const writeWelcomePrefsFromRefs = useCallback(() => {
    if (welcomePrefsWriteSelectedChatIdRef.current !== null) return;
    if (welcomePrefsWriteWelcomeCoworkerSlugRef.current != null) return;
    writeWelcomeComposePreferences(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: welcomeSelectedCoworkerRef.current,
        model: welcomeSelectedModelRef.current,
      }),
    );
  }, []);

  const handleWelcomeCoworkerChange = useCallback(
    (coworker: Coworker | null) => {
      setWelcomeSelectedCoworker(coworker);
      setWelcomeSelectedModel(null);
      welcomeSelectedCoworkerRef.current = coworker;
      welcomeSelectedModelRef.current = null;
      writeWelcomePrefsFromRefs();
    },
    [writeWelcomePrefsFromRefs],
  );

  const handleWelcomeModelChange = useCallback(
    (model: { id: string; name: string } | null) => {
      setWelcomeSelectedModel(model);
      if (model) {
        setWelcomeSelectedCoworker(null);
        welcomeSelectedCoworkerRef.current = null;
      }
      welcomeSelectedModelRef.current = model;
      writeWelcomePrefsFromRefs();
    },
    [writeWelcomePrefsFromRefs],
  );

  const previousSelectedChatIdForComposeRef = useRef<string | null>(
    selectedChatId,
  );
  const previousControlledConversationIdRef = useRef<string | null>(
    controlledConversationId,
  );
  // Invalidate stored welcome prefs during render so the hydration
  // `useLayoutEffect` runs before paint (avoids one frame of stale welcome UI).
  const previousComposeSelectedChatId =
    previousSelectedChatIdForComposeRef.current;
  if (previousComposeSelectedChatId !== selectedChatId) {
    if (previousComposeSelectedChatId !== null && selectedChatId === null) {
      welcomePrefsHydratedRef.current = false;
    }
    previousSelectedChatIdForComposeRef.current = selectedChatId;
  }
  if (previousWelcomeCoworkerSlugRef.current !== welcomeCoworkerSlug) {
    welcomePrefsHydratedRef.current = false;
    previousWelcomeCoworkerSlugRef.current = welcomeCoworkerSlug;
  }

  useLayoutEffect(() => {
    if (selectedChatId !== null) return;
    if (coworkers.length === 0) return;
    if (welcomePrefsHydratedRef.current) return;
    welcomePrefsHydratedRef.current = true;

    const stored = readWelcomeComposePreferences();
    const resolved = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: welcomeCoworkerSlug != null,
    });

    if (welcomeCoworkerSlug != null) {
      setWelcomeSelectedModel(null);
      setWelcomeSelectedCoworker(null);
      return;
    }

    if (resolved.model) {
      setWelcomeSelectedModel(resolved.model);
      setWelcomeSelectedCoworker(null);
      return;
    }

    if (resolved.coworker) {
      setWelcomeSelectedCoworker(resolved.coworker);
      setWelcomeSelectedModel(null);
      return;
    }

    setWelcomeSelectedCoworker(null);
    setWelcomeSelectedModel(null);
  }, [selectedChatId, coworkers, welcomeCoworkerSlug]);

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

  const pendingConversationStorageKey = getPendingConversationStorageKey();

  useEffect(() => {
    if (isRouteDriven) {
      previousControlledConversationIdRef.current = controlledConversationId;
      return;
    }

    const previousControlled = previousControlledConversationIdRef.current;
    setSelectedChatId(controlledConversationId);

    if (controlledConversationId !== null) {
      previousControlledConversationIdRef.current = controlledConversationId;
      return;
    }

    previousControlledConversationIdRef.current = null;

    loadingConversationIdRef.current = null;
    currentChatIdRef.current = null;
    pendingUrlConversationIdRef.current = null;
    setSelectedModel(null);
    selectedModelRef.current = null;
    setInput("");
    // Only invalidate welcome hydration when leaving a conversation for welcome;
    // initial mount with null must not clear the flag after useLayoutEffect hydrated.
    if (previousControlled !== null) {
      welcomePrefsHydratedRef.current = false;
    }
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
        pendingConversationStorageKey,
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
        sessionStorage.removeItem(pendingConversationStorageKey);
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
    pendingConversationStorageKey,
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
  const slotBoundConversationIdRef = useRef<(string | null)[]>([
    null,
    null,
    null,
  ]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useLayoutEffect(() => {
    for (let s = 0; s < NUM_SLOTS; s++) {
      slotBoundConversationIdRef.current[s] = slotToConversation.get(s) ?? null;
    }
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

  function makeSlotTransport(slotIndex: number, api: string) {
    return new DefaultChatTransport({
      api,
      headers: () => {
        const slug = organizationSlugRef.current;
        return slug
          ? { "x-organization-slug": slug }
          : ({} as Record<string, string>);
      },
      prepareSendMessagesRequest(options: {
        id: string;
        messages: UIMessage[];
        body: Record<string, unknown> | undefined;
        trigger: "submit-message" | "regenerate-message";
        messageId: string | undefined;
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
        const chatIdForBody =
          typeof cid === "string" && cid.length > 0 ? cid : options.id;
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

        const baseBody: Record<string, unknown> = {
          ...(options.body ?? {}),
          id: chatIdForBody,
          trigger: options.trigger,
          messageId: options.messageId,
          ...(typeof cid === "string" && cid.length > 0
            ? { conversationId: cid }
            : {}),
          ...(payload?.model ? { model: payload.model.id } : {}),
          ...(previousResponseIdForBody
            ? { previousResponseId: previousResponseIdForBody }
            : {}),
        };

        if (
          options.trigger === "submit-message" &&
          typeof cid === "string" &&
          cid.length > 0
        ) {
          const last = options.messages[options.messages.length - 1];
          if (last) {
            return {
              body: {
                ...baseBody,
                message: last,
              },
            };
          }
        }

        return {
          body: {
            ...baseBody,
            messages: options.messages,
          },
        };
      },
      prepareReconnectToStreamRequest({
        id,
        requestMetadata: _requestMetadata,
        body: _body,
        credentials: _credentials,
        headers: _headers,
        api: _api,
      }) {
        const slug = organizationSlugRef.current;
        const headers = slug
          ? ({ "x-organization-slug": slug } as Record<string, string>)
          : undefined;
        const payload = slotPayloadRef.current[slotIndex];
        const fromPayload = payload?.conversationId?.trim() ?? "";
        const fromBound =
          slotBoundConversationIdRef.current[slotIndex]?.trim() ?? "";
        const streamConversationId =
          (fromPayload.length > 0 && isConversationUuid(fromPayload)
            ? fromPayload
            : null) ??
          (fromBound.length > 0 && isConversationUuid(fromBound)
            ? fromBound
            : null) ??
          (typeof id === "string" && id.length > 0 && isConversationUuid(id)
            ? id
            : null);
        if (streamConversationId == null) {
          return {
            api: CHAT_NO_RESUMABLE_STREAM_PATH,
            credentials: "include" as RequestCredentials,
            headers,
          };
        }
        return {
          api: `/api/chat/${streamConversationId}/stream`,
          credentials: "include" as RequestCredentials,
          headers,
        };
      },
    });
  }

  const slot0BoundId = slotToConversation.get(0) ?? null;
  const slot1BoundId = slotToConversation.get(1) ?? null;
  const slot2BoundId = slotToConversation.get(2) ?? null;

  const { resumeSlot0, resumeSlot1, resumeSlot2 } = useMemo(() => {
    function slotResumeFor(boundId: string | null): boolean {
      if (!boundId) return false;
      const meta =
        selectedConversation?.id === boundId
          ? (selectedConversation.metadata as
              | Record<string, unknown>
              | null
              | undefined)
          : (conversations.find((c) => c.id === boundId)?.metadata as
              | Record<string, unknown>
              | null
              | undefined);
      return readActiveUiStreamIdFromMetadata(meta) != null;
    }
    return {
      resumeSlot0: slotResumeFor(slot0BoundId),
      resumeSlot1: slotResumeFor(slot1BoundId),
      resumeSlot2: slotResumeFor(slot2BoundId),
    };
  }, [
    slot0BoundId,
    slot1BoundId,
    slot2BoundId,
    conversations,
    selectedConversation?.id,
    selectedConversation?.metadata,
  ]);

  const transport0 = useMemo(
    () => makeSlotTransport(0, CHAT_API_PATH),
    [CHAT_API_PATH],
  );
  const transport1 = useMemo(
    () => makeSlotTransport(1, CHAT_API_PATH),
    [CHAT_API_PATH],
  );
  const transport2 = useMemo(
    () => makeSlotTransport(2, CHAT_API_PATH),
    [CHAT_API_PATH],
  );

  const slot0InitialMessages = useMemo(
    () =>
      (slot0BoundId
        ? (cachedMessagesByConversation[slot0BoundId] ?? [])
        : []) as UIMessage[],
    [slot0BoundId, cachedMessagesByConversation],
  );
  const slot1InitialMessages = useMemo(
    () =>
      (slot1BoundId
        ? (cachedMessagesByConversation[slot1BoundId] ?? [])
        : []) as UIMessage[],
    [slot1BoundId, cachedMessagesByConversation],
  );
  const slot2InitialMessages = useMemo(
    () =>
      (slot2BoundId
        ? (cachedMessagesByConversation[slot2BoundId] ?? [])
        : []) as UIMessage[],
    [slot2BoundId, cachedMessagesByConversation],
  );

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
    id: SLOT_PLACEHOLDER_CHAT_IDS[0],
    messages: slot0InitialMessages,
    resume: resumeSlot0,
    transport: transport0,
    onData: onDataForSlot(0),
    onError: onErrorForSlot(0),
    onFinish: onFinishForSlot(0),
  });
  const chat1 = useChat({
    id: SLOT_PLACEHOLDER_CHAT_IDS[1],
    messages: slot1InitialMessages,
    resume: resumeSlot1,
    transport: transport1,
    onData: onDataForSlot(1),
    onError: onErrorForSlot(1),
    onFinish: onFinishForSlot(1),
  });
  const chat2 = useChat({
    id: SLOT_PLACEHOLDER_CHAT_IDS[2],
    messages: slot2InitialMessages,
    resume: resumeSlot2,
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
      if (slot !== undefined && slot >= 0 && slot < NUM_SLOTS) {
        setMessagesSlots[slot]((prev) => {
          const prevArr = (prev ?? []) as UIMessage[];
          if (prevArr.length === 0 && messages.length > 0) {
            return messages;
          }
          if (messages.length === 0) {
            return prevArr;
          }
          return mergeAssistantThoughtMetadataFromDb(prevArr, messages);
        });
        return;
      }
      setCachedMessagesByConversation((prev) => ({
        ...prev,
        [convId]: messages,
      }));
      chatMessagesRef.current.set(convId, messages);
    },
    [conversationToSlot, setMessagesSlots],
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
      slotBoundConversationIdRef.current[slot] = null;
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
      const messages = (slotMessages[slot] ?? []) as UIMessage[];
      const last = messages[messages.length - 1];
      const hasReasoningInAssistantParts =
        last != null &&
        (last.role as string) === "assistant" &&
        extractReasoningStepMessages(last).length > 0;
      const hasReasoningSteps =
        (steps != null && steps.length > 0) || hasReasoningInAssistantParts;
      if (hasReasoningSteps && effectiveStarted[slot] == null) {
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
    (
      conversationId: string,
      message: ChatSendMessage,
      sendOptions?: Parameters<UseChatHelpers<UIMessage>["sendMessage"]>[1],
    ): boolean => {
      const payload = toChatSendMessage(message);
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
        slotBoundConversationIdRef.current[slot] = conversationId;
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
        const slotToSend = slot;
        queueMicrotask(() => {
          sendMessageSlots[slotToSend](payload, sendOptions);
        });
        return true;
      }
      sendMessageSlots[slot](payload, sendOptions);
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

  const isLoading = isSelectedChatLoading;
  const isConversationLoading =
    Boolean(selectedChatId) && selectedConversation?.id !== selectedChatId;

  const selectedChatReasoningMessages = useMemo(() => {
    if (!selectedChatId) return [];
    const slot = conversationToSlot.get(selectedChatId);
    const slotSteps = slot !== undefined ? (reasoningBySlot[slot] ?? []) : [];

    const messages = displayedMessages;
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if ((messages[i]?.role as string) === "user") {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex >= 0) {
      for (let i = lastUserIndex + 1; i < messages.length; i++) {
        const m = messages[i];
        if ((m?.role as string) !== "assistant") continue;
        const fromParts = extractReasoningStepMessages(m);
        if (fromParts.length > 0) return fromParts;
        return slotSteps;
      }
      return slotSteps;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "assistant") {
        const fromParts = extractReasoningStepMessages(m);
        if (fromParts.length > 0) return fromParts;
        break;
      }
    }
    return slotSteps;
  }, [selectedChatId, displayedMessages, conversationToSlot, reasoningBySlot]);

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

  const { userTailRecoveryLoading, userTailRecoveryFailed } =
    useCoworkerPostRefreshAssistantPoll({
      conversationId: selectedChatId,
      isCoworkerThread: isSelectedChatCoworker,
      isChatStreaming: isSelectedChatLoading,
      conversationMetadata:
        selectedConversation?.id === selectedChatId
          ? (selectedConversation.metadata as Record<string, unknown> | null)
          : undefined,
      messagesChatIdRef,
      displayedMessages,
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
      options?: { imageGeneration?: boolean },
    ): Promise<string | null> => {
      if (!model) {
        setSelectedModel(null);
        selectedModelRef.current = null;
        return null;
      }
      const conversation = await createModelChat(model, options);
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

  const selectedConversationImageGeneration = useMemo(() => {
    if (!selectedChatId) {
      return false;
    }

    const selectedMetadata =
      selectedConversation?.id === selectedChatId
        ? (selectedConversation.metadata as Record<string, unknown> | null)
        : ((conversations.find((c) => c.id === selectedChatId)?.metadata ??
            null) as Record<string, unknown> | null);

    return (
      readConversationImageGenerationFromMetadata(selectedMetadata) ||
      hasImageGenerationUiMessage(displayedMessages)
    );
  }, [
    conversations,
    displayedMessages,
    selectedChatId,
    selectedConversation?.id,
    selectedConversation?.metadata,
  ]);

  const handleSendMessage = useCallback(
    async (
      message: ChatComposeMessage,
      coworker?: Coworker,
      model?: { id: string; name: string },
      options?: ChatComposeSubmitOptions,
    ): Promise<boolean> => {
      if (
        !hasSendMessageContent(message) ||
        isLoading ||
        (!selectedChatId &&
          (welcomeCreationInFlightRef.current || isWelcomeTransitioning))
      ) {
        return false;
      }

      const imageGenerationForSend =
        options?.imageGeneration === true ||
        (selectedChatId != null && selectedConversationImageGeneration);
      const _messageText = getSendMessageText(message);
      const sendPayload = withImageGenerationMetadata(
        toChatSendMessage(message),
        imageGenerationForSend,
      );
      const sendOptions = imageGenerationForSend
        ? { body: { imageGeneration: true } }
        : undefined;

      if (!selectedChatId) {
        welcomeCreationInFlightRef.current = true;
        setIsWelcomeSubmitting(true);
        try {
          setIsWelcomeTransitioning(true);
          await new Promise((resolve) => setTimeout(resolve, 300));

          let conversationId: string | null = null;

          if (model || selectedModel) {
            const modelToUse = model || selectedModel;
            if (modelToUse) {
              conversationId = await handleModelSelected(modelToUse, {
                imageGeneration: imageGenerationForSend,
              });
            }
          } else {
            const selectedCoworker =
              (coworker && coworkerHasCapability(coworker, "chat")
                ? coworker
                : null) ??
              (effectiveWelcomeCoworker &&
              coworkerHasCapability(effectiveWelcomeCoworker, "chat")
                ? effectiveWelcomeCoworker
                : null) ??
              coworkers.find((candidate) =>
                coworkerHasCapability(candidate, "chat"),
              ) ??
              null;
            if (!selectedCoworker) {
              toast.error(t("noCoworkersAvailable"));
              setIsWelcomeTransitioning(false);
              return false;
            }
            conversationId = await handleCoworkerSelected(selectedCoworker);
          }

          if (!conversationId) {
            setIsWelcomeTransitioning(false);
            return false;
          }

          if (!currentChatIdRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (!currentChatIdRef.current) {
              setIsWelcomeTransitioning(false);
              return false;
            }
          }

          const cid = currentChatIdRef.current ?? conversationId;
          const sent = cid
            ? sendInConversation(cid, sendPayload, sendOptions)
            : false;
          if (sent) setInput("");
          return sent;
        } finally {
          welcomeCreationInFlightRef.current = false;
          setIsWelcomeSubmitting(false);
        }
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

      const sent = sendInConversation(selectedChatId, sendPayload, sendOptions);
      if (sent) setInput("");
      return sent;
    },
    [
      coworkers,
      isLoading,
      isWelcomeTransitioning,
      selectedChatId,
      selectedConversationImageGeneration,
      sendInConversation,
      setInput,
      handleCoworkerSelected,
      handleModelSelected,
      selectedModel,
      effectiveWelcomeCoworker,
      t,
      router,
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
    (message?: ChatSendMessage) => {
      const cid = selectedChatId ?? currentChatIdRef.current;
      if (!cid) return Promise.resolve();
      if (message && hasSendMessageContent(message)) {
        sendInConversation(cid, message);
      }
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
    async (message: UIMessage) => {
      if (!selectedChatId) return;
      const isImageGeneration = readImageGenerationFromMessage(message);
      const resendPayload = buildResendMessage(message);
      if (!resendPayload) return;
      const sendPayload = withImageGenerationMetadata(
        resendPayload,
        isImageGeneration,
      );
      const list = await refreshConversations();
      const conv = list?.find((c) => c.id === selectedChatId);
      const pid = readPreviousResponseIdFromMetadata(
        conv?.metadata as Record<string, unknown> | null,
      );
      if (pid) {
        resendPreviousResponseIdOverrideRef.current.set(selectedChatId, pid);
      }
      sendInConversation(
        selectedChatId,
        sendPayload,
        isImageGeneration ? { body: { imageGeneration: true } } : undefined,
      );
    },
    [selectedChatId, sendInConversation, refreshConversations],
  );

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
    <div className="relative flex h-full w-full flex-col overflow-visible rounded-lg">
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
                    conversationCoworkerFallback={
                      selectedChatCoworker
                        ? {
                            id: selectedChatCoworker.id,
                            name: selectedChatCoworker.name,
                            avatar: selectedChatCoworker.avatar,
                          }
                        : null
                    }
                    isLoading={isLoading || userTailRecoveryLoading}
                    isCoworker={isSelectedChatCoworker}
                    messages={displayedMessages}
                    onResendLastMessage={handleResendLastMessage}
                    userTailRecoveryFailed={userTailRecoveryFailed}
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
                  className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-5 h-32 bg-linear-to-t to-transparent"
                />
                <ChatInputContainer
                  key={selectedChatId}
                  mobileKeyboardOptimized={mobileKeyboardOptimized}
                  selectedChatId={selectedChatId}
                  input={input}
                  setInput={setInput}
                  status={selectedChatStatus}
                  stop={noopChatComposerStop}
                  messages={displayedMessages}
                  setMessages={setMessagesForInput}
                  sendMessage={sendMessageForInput}
                  onSendMessage={handleSendMessage}
                  selectedModel={selectedModel}
                  onSelectModel={handleModelSelected}
                  selectedChatCoworker={selectedChatCoworker}
                  coworkers={coworkers}
                  persistentImageGeneration={
                    selectedConversationImageGeneration
                  }
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
            welcomeSendBlocked={isWelcomeSubmitting || isWelcomeTransitioning}
            isTransitioning={isWelcomeTransitioning}
            input={input}
            setInput={setInput}
            messages={[]}
            setMessages={() => {}}
            sendMessage={sendMessageForInput}
            status="ready"
            stop={noopChatComposerStop}
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
