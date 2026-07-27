"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import {
  Bot,
  ChevronDown,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Plus,
} from "lucide-react";
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
import { flushSync } from "react-dom";
import { toast } from "sonner";
import ChatInputContainer from "@/app/chat/components/chat-input-container";
import SelectCoworkerModal from "@/app/chat/components/select-coworker-modal";
import WelcomeScreen from "@/app/chat/components/welcome-screen";
import { useChatMessages } from "@/app/chat/hooks/use-chat-messages";
import { useChatPreview } from "@/app/chat/hooks/use-chat-preview";
import { useChatSync } from "@/app/chat/hooks/use-chat-sync";
import { useConversationWarmup } from "@/app/chat/hooks/use-conversation-warmup";
import { useCoworkerPostRefreshAssistantPoll } from "@/app/chat/hooks/use-coworker-post-refresh-assistant-poll";
import {
  displaySlugFromMetadata,
  getBucketKeyFromMetadata,
  slugify,
} from "@/app/chat/utils/bucket-slug";
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
  isCoworkerChatConflictError,
  removeTrailingUserUiMessage,
} from "@/app/chat-ui/utils/chat-api-error";
import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  getBucketSlugFromChatPathname,
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
  reconcileSlotMessagesWithDb,
} from "@/app/chat-ui/utils/message-utils";
import {
  clearPendingCoworkerDirectMessage,
  isPendingCoworkerDirectMessageFresh,
  pendingCoworkerDirectMessageMatchesBucket,
  readPendingCoworkerDirectMessage,
} from "@/app/chat-ui/utils/pending-coworker-direct-message";
import {
  cancelCoworkerDbSync,
  hasGoodCoworkerAssistantTail,
  isStaleCoworkerAssistantTail,
  shouldRejectCoworkerMessageRegression,
  syncCoworkerSlotFromDbWithRetry,
} from "@/app/chat-ui/utils/sync-coworker-slot-from-db";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { Conversation } from "@/lib/actions/conversation";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { isCoworkerWarmupReadyForWelcomeSend } from "../utils/welcome-send-warmup";
import MessageList from "./message-list";

const NUM_SLOTS = 3;

const WELCOME_SEND_RETRY_DELAYS_MS = [
  50, 150, 350, 700, 1500, 5000, 10_000,
] as const;
const WELCOME_SEND_MAX_AGE_MS =
  WELCOME_SEND_RETRY_DELAYS_MS[WELCOME_SEND_RETRY_DELAYS_MS.length - 1] + 500;
/** Match `useConversationWarmup` poll timeout plus buffer for the welcome send effect. */
const WELCOME_SEND_COWORKER_MAX_AGE_MS = 35_000;

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

const SELECT_CONVERSATION_MAX_RETRIES = 3;
const SELECT_CONVERSATION_RETRY_DELAY_MS = 1500;

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

function isPendingWelcomeSendForConversation(
  pending: { conversationId: string } | null,
  conversationId: string | null,
): boolean {
  return (
    pending != null &&
    (conversationId == null || pending.conversationId === conversationId)
  );
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

const PENDING_WELCOME_USER_MESSAGE_ID = "__pending-welcome-user__";

function buildOptimisticUserUiMessage(payload: ChatSendMessage): UIMessage {
  if (typeof payload === "object" && payload != null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.parts)) {
      return {
        id: PENDING_WELCOME_USER_MESSAGE_ID,
        role: "user",
        parts: record.parts as UIMessage["parts"],
      };
    }
    if (typeof record.text === "string") {
      return {
        id: PENDING_WELCOME_USER_MESSAGE_ID,
        role: "user",
        parts: [{ type: "text", text: record.text }],
      };
    }
  }

  return {
    id: PENDING_WELCOME_USER_MESSAGE_ID,
    role: "user",
    parts: [{ type: "text", text: String(payload) }],
  };
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

function getConversationListTitle(
  conversation: Conversation,
  fallbackTitle: string,
): string {
  const title = conversation.title?.trim();
  if (title && title !== fallbackTitle) {
    return title;
  }
  return fallbackTitle;
}

interface CoworkerConversationSwitcherProps {
  bucketSlug: string;
  conversations: Conversation[];
  currentConversationId: string;
  displayName: string;
  onCreateConversation: () => Promise<boolean>;
}

function CoworkerConversationSwitcher({
  bucketSlug,
  conversations,
  currentConversationId,
  displayName,
  onCreateConversation,
}: CoworkerConversationSwitcherProps) {
  const t = useTranslations("App.Chat.Chat");
  const router = useRouter();
  const { formatTimeAgo } = useLocalizedDateTime();
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateConversation = useCallback(async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const created = await onCreateConversation();
      if (created) {
        setOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, onCreateConversation]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      setOpen(false);
      router.push(
        `${CHAT_APP_ROUTE_PREFIX}/${bucketSlug}/conversation/${conversationId}`,
        {
          scroll: false,
        },
      );
    },
    [bucketSlug, router],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-2.5"
          aria-label={t("conversationSwitcher")}
          title={t("conversationSwitcher")}
        >
          <MessagesSquare className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("conversationSwitcher")}</span>
          <span className="text-muted-foreground text-xs">
            {conversations.length}
          </span>
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <p className="text-sm font-semibold">{t("conversationSwitcher")}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            onClick={() => {
              void handleCreateConversation();
            }}
            disabled={isCreating}
            aria-label={t("newChat")}
            title={t("newChat")}
          >
            {isCreating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <div className="space-y-1 p-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === currentConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={cn(
                    "hover:bg-muted/70 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                    isActive && "bg-muted",
                  )}
                  onClick={() => handleSelectConversation(conversation.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <MessageCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {getConversationListTitle(conversation, displayName)}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {formatTimeAgo(conversation.updatedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CoworkerChatHeaderProps {
  bucketSlug: string;
  conversations: Conversation[];
  currentConversationId: string;
  displayName: string;
  onCreateConversation: () => Promise<boolean>;
}

function CoworkerChatHeader({
  bucketSlug,
  conversations,
  currentConversationId,
  displayName,
  onCreateConversation,
}: CoworkerChatHeaderProps) {
  return (
    // In flow, like the channels header: the surrounding column is
    // header / list / composer, so nothing needs to reserve space for it.
    <header className="bg-background z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MessageCircle className="text-muted-foreground size-4 shrink-0" />
        <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-sm">
          <span className="truncate">{displayName}</span>
          <Bot className="size-3.5 shrink-0" aria-label="AI coworker" />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <CoworkerConversationSwitcher
          bucketSlug={bucketSlug}
          conversations={conversations}
          currentConversationId={currentConversationId}
          displayName={displayName}
          onCreateConversation={onCreateConversation}
        />
      </div>
    </header>
  );
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
  const selectRetryRef = useRef<{ id: string; attempts: number }>({
    id: "",
    attempts: 0,
  });
  const [selectRetryTick, setSelectRetryTick] = useState(0);
  useEffect(() => {
    if (!selectedChatId) return;
    if (isRouteDriven && !isChatPath) return;
    // pathname and selectedChatId update on different ticks while switching
    // conversations. Keying hydration on the pair while they disagree forced a
    // spurious re-fetch of the *previous* conversation on every switch (whose
    // late response could clobber the newly selected one), so the route key
    // only exists once both point at the same conversation.
    const routeConversationKey =
      isRouteDriven && isChatPath && conversationIdFromPath === selectedChatId
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
    void selectConversation(selectedChatId)
      .then((conversation) => {
        if (conversation != null) {
          selectRetryRef.current = { id: selectedChatId, attempts: 0 };
          return;
        }
        // A failed select (timeout, dropped server action, transient Core
        // error) must not leave the spinner up forever — retry a bounded
        // number of times while this conversation is still selected.
        const attempts =
          selectRetryRef.current.id === selectedChatId
            ? selectRetryRef.current.attempts
            : 0;
        if (attempts >= SELECT_CONVERSATION_MAX_RETRIES) {
          return;
        }
        selectRetryRef.current = { id: selectedChatId, attempts: attempts + 1 };
        window.setTimeout(() => {
          setSelectRetryTick((tick) => tick + 1);
        }, SELECT_CONVERSATION_RETRY_DELAY_MS);
      })
      .finally(() => {
        if (loadingConversationIdRef.current === selectedChatId) {
          loadingConversationIdRef.current = null;
        }
      });
  }, [
    conversationIdFromPath,
    isChatPath,
    isRouteDriven,
    pathname,
    selectedChatId,
    selectedConversation?.id,
    selectConversation,
    selectRetryTick,
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
  const effectiveWelcomeCoworker = useMemo(() => {
    const candidate =
      welcomeCoworkerSlug != null
        ? initialWelcomeCoworker
        : (welcomeSelectedCoworker ?? initialWelcomeCoworker);
    if (!candidate) {
      return null;
    }
    return coworkerHasCapability(candidate, "chat") ? candidate : null;
  }, [initialWelcomeCoworker, welcomeCoworkerSlug, welcomeSelectedCoworker]);

  const [isWelcomeSubmitting, setIsWelcomeSubmitting] = useState(false);
  const [welcomeSendRetryTick, setWelcomeSendRetryTick] = useState(0);
  const welcomeCreationInFlightRef = useRef(false);
  const pendingCoworkerDirectMessageKeyRef = useRef<string | null>(null);
  const pendingWelcomeSendRef = useRef<{
    conversationId: string;
    bucketSlug: string;
    isCoworker: boolean;
    payload: ChatSendMessage;
    sendOptions?: Parameters<UseChatHelpers<UIMessage>["sendMessage"]>[1];
    createdAt: number;
    navigationRequested: boolean;
  } | null>(null);

  const welcomePrefsHydratedRef = useRef(false);
  const previousWelcomeCoworkerSlugRef = useRef<string | null>(
    welcomeCoworkerSlug,
  );
  const welcomeSelectedCoworkerRef = useRef<Coworker | null>(null);
  const welcomePrefsWriteSelectedChatIdRef = useRef<string | null>(null);
  const welcomePrefsWriteWelcomeCoworkerSlugRef = useRef<string | null>(null);
  welcomeSelectedCoworkerRef.current = welcomeSelectedCoworker;
  welcomePrefsWriteSelectedChatIdRef.current = selectedChatId;
  welcomePrefsWriteWelcomeCoworkerSlugRef.current = welcomeCoworkerSlug;

  const writeWelcomePrefsFromRefs = useCallback(() => {
    if (welcomePrefsWriteSelectedChatIdRef.current !== null) return;
    if (welcomePrefsWriteWelcomeCoworkerSlugRef.current != null) return;
    writeWelcomeComposePreferences(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: welcomeSelectedCoworkerRef.current,
      }),
    );
  }, []);

  const handleWelcomeCoworkerChange = useCallback(
    (coworker: Coworker | null) => {
      setWelcomeSelectedCoworker(coworker);
      welcomeSelectedCoworkerRef.current = coworker;
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
      setWelcomeSelectedCoworker(null);
      return;
    }

    if (resolved.coworker) {
      setWelcomeSelectedCoworker(resolved.coworker);
      return;
    }

    setWelcomeSelectedCoworker(null);
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
      if (pendingUrlConversationIdRef.current === controlledConversationId) {
        pendingUrlConversationIdRef.current = null;
      }
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

  const setMessagesForConversationRef = useRef<
    (
      convId: string,
      messages: UIMessage[],
      options?: { forceFromDb?: boolean },
    ) => void
  >(() => {});

  const getLiveSlotMessagesForConversationRef = useRef<
    (conversationId: string) => UIMessage[]
  >(() => []);

  const setMessagesSlotsRef = useRef<
    Array<UseChatHelpers<UIMessage>["setMessages"] | undefined>
  >([undefined, undefined, undefined]);

  const [coworkerResponseInProgress, setCoworkerResponseInProgress] = useState<
    Record<string, true>
  >({});

  const onErrorForSlot = useCallback(
    (slotIndex: number) => (error: unknown) => {
      console.error(`Chat API error (slot ${slotIndex}):`, error);
      const convId = slotPayloadRef.current[slotIndex]?.conversationId ?? null;
      if (convId) {
        welcomeCreationInFlightRef.current = false;
        const isCoworkerThread =
          (
            conversations.find((c) => c.id === convId)?.metadata as
              | Record<string, unknown>
              | null
              | undefined
          )?.type === "coworker" ||
          Boolean(chats.find((c) => c.id === convId)?.coworker);
        if (isCoworkerThread) {
          let slotMessagesSnapshot =
            getLiveSlotMessagesForConversationRef.current(convId);
          if (isCoworkerChatConflictError(error)) {
            setCoworkerResponseInProgress((prev) => ({
              ...prev,
              [convId]: true,
            }));
            if (pendingWelcomeSendRef.current?.conversationId === convId) {
              pendingWelcomeSendRef.current = null;
            }
            const setSlotMessages = setMessagesSlotsRef.current[slotIndex];
            if (setSlotMessages) {
              setSlotMessages((prev) =>
                removeTrailingUserUiMessage((prev ?? []) as UIMessage[]),
              );
            }
            slotMessagesSnapshot =
              removeTrailingUserUiMessage(slotMessagesSnapshot);
            setMessagesForConversationRef.current(convId, slotMessagesSnapshot);
            chatMessagesRef.current.set(convId, slotMessagesSnapshot);
          }
          void syncCoworkerSlotFromDbWithRetry({
            conversationId: convId,
            slotMessages: slotMessagesSnapshot,
            getLiveSlotMessages: () =>
              getLiveSlotMessagesForConversationRef.current(convId),
            onApply: (dbMessages) => {
              setMessagesForConversationRef.current(convId, dbMessages, {
                forceFromDb: true,
              });
              chatMessagesRef.current.set(convId, dbMessages);
              if (hasGoodCoworkerAssistantTail(dbMessages)) {
                setCoworkerResponseInProgress((prev) => {
                  if (!prev[convId]) {
                    return prev;
                  }
                  const next = { ...prev };
                  delete next[convId];
                  return next;
                });
              }
            },
          });
          return;
        }
        void selectConversation(convId);
      }
    },
    [selectConversation, conversations, chats],
  );

  const onFinishForSlot = useCallback(
    (slotIndex: number) =>
      ({ messages: finishedMessages }: { messages: UIMessage[] }) => {
        const payload = slotPayloadRef.current[slotIndex];
        const conversationId = payload?.conversationId ?? null;
        if (!conversationId || finishedMessages.length === 0) return;

        if (welcomeCreationInFlightRef.current) {
          welcomeCreationInFlightRef.current = false;
        }

        const isCoworkerThread =
          (
            conversations.find((c) => c.id === conversationId)?.metadata as
              | Record<string, unknown>
              | null
              | undefined
          )?.type === "coworker" ||
          Boolean(chats.find((c) => c.id === conversationId)?.coworker);

        void (async () => {
          const lastAssistantMessage = [...finishedMessages]
            .reverse()
            .find((msg) => msg.role === "assistant");
          const content = lastAssistantMessage
            ? extractMessageContent(lastAssistantMessage).trim()
            : "";

          if (!isCoworkerThread) {
            void refreshConversations();
            if (
              content &&
              previousChatIdRef.current === conversationId &&
              messagesChatIdRef.current === conversationId &&
              updateChatPreviewRef.current
            ) {
              const isFirstAssistantMessage =
                finishedMessages.filter((m) => m.role === "assistant")
                  .length === 1;
              updateChatPreviewRef.current(
                conversationId,
                content,
                isFirstAssistantMessage,
              );
            }
            return;
          }

          if (content.length > 0) {
            setMessagesForConversationRef.current(
              conversationId,
              finishedMessages,
              { forceFromDb: true },
            );
            chatMessagesRef.current.set(conversationId, finishedMessages);
          }

          await syncCoworkerSlotFromDbWithRetry({
            conversationId,
            slotMessages: finishedMessages,
            getLiveSlotMessages: () =>
              getLiveSlotMessagesForConversationRef.current(conversationId),
            onApply: (dbMessages) => {
              setMessagesForConversationRef.current(
                conversationId,
                dbMessages,
                {
                  forceFromDb: true,
                },
              );
              chatMessagesRef.current.set(conversationId, dbMessages);

              const dbTail = dbMessages[dbMessages.length - 1];
              const dbContent =
                dbTail?.role === "assistant"
                  ? extractMessageContent(dbTail).trim()
                  : "";
              if (
                dbContent &&
                previousChatIdRef.current === conversationId &&
                messagesChatIdRef.current === conversationId &&
                updateChatPreviewRef.current
              ) {
                const isFirstAssistantMessage =
                  dbMessages.filter((m) => m.role === "assistant").length === 1;
                updateChatPreviewRef.current(
                  conversationId,
                  dbContent,
                  isFirstAssistantMessage,
                );
              }
            },
          });
          void refreshConversations();
        })();
      },
    [refreshConversations, conversations, chats],
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

  useLayoutEffect(() => {
    setMessagesSlotsRef.current = setMessagesSlots;
  }, [setMessagesSlots]);

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

  const messagesForMessageList = useMemo(() => {
    const pending = pendingWelcomeSendRef.current;
    if (
      !pending ||
      pending.conversationId !== selectedChatId ||
      displayedMessages.some((message) => (message.role as string) === "user")
    ) {
      return displayedMessages;
    }

    return [
      ...displayedMessages,
      buildOptimisticUserUiMessage(pending.payload),
    ];
  }, [displayedMessages, selectedChatId, welcomeSendRetryTick]);

  const isSelectedChatLoading =
    Boolean(selectedChatId) &&
    (() => {
      const slot = conversationToSlot.get(selectedChatId!);
      if (slot === undefined) return false;
      const s = slotStatuses[slot];
      return s === "streaming" || s === "submitted";
    })();

  useEffect(() => {
    if (!selectedChatId || !isSelectedChatLoading) {
      return;
    }
    setCoworkerResponseInProgress((prev) => {
      if (!prev[selectedChatId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[selectedChatId];
      return next;
    });
  }, [selectedChatId, isSelectedChatLoading]);

  const slotMessagesRef = useRef<UIMessage[][]>([[], [], []]);
  useLayoutEffect(() => {
    slotMessagesRef.current = slotMessages as UIMessage[][];
  }, [slotMessages]);

  const getLiveSlotMessagesForConversation = useCallback(
    (conversationId: string): UIMessage[] => {
      const slot = conversationToSlot.get(conversationId);
      if (slot !== undefined && slot >= 0 && slot < NUM_SLOTS) {
        return (slotMessagesRef.current[slot] ?? []) as UIMessage[];
      }
      return cachedMessagesByConversation[conversationId] ?? [];
    },
    [conversationToSlot, cachedMessagesByConversation],
  );
  getLiveSlotMessagesForConversationRef.current =
    getLiveSlotMessagesForConversation;

  const [messageListRevision, setMessageListRevision] = useState(0);

  const bumpMessageListRevision = useCallback(() => {
    setMessageListRevision((revision) => revision + 1);
  }, []);

  const setMessagesForConversation = useCallback(
    (
      convId: string,
      messages: UIMessage[],
      options?: { forceFromDb?: boolean },
    ) => {
      if (
        !options?.forceFromDb &&
        streamingConversationIdsRef.current.has(convId)
      ) {
        return;
      }
      const slot = conversationToSlot.get(convId);
      const applySlotMessages = (apply: () => void) => {
        if (options?.forceFromDb) {
          flushSync(apply);
          bumpMessageListRevision();
        } else {
          apply();
        }
      };
      if (slot !== undefined && slot >= 0 && slot < NUM_SLOTS) {
        applySlotMessages(() => {
          setMessagesSlots[slot]((prev) => {
            const prevArr = (prev ?? []) as UIMessage[];
            if (
              shouldRejectCoworkerMessageRegression(prevArr, messages) &&
              !options?.forceFromDb
            ) {
              return prevArr;
            }
            if (options?.forceFromDb) {
              return messages;
            }
            if (prevArr.length === 0 && messages.length > 0) {
              return messages;
            }
            if (messages.length === 0) {
              return prevArr;
            }
            return reconcileSlotMessagesWithDb(prevArr, messages);
          });
        });
        return;
      }
      applySlotMessages(() => {
        setCachedMessagesByConversation((prev) => ({
          ...prev,
          [convId]: messages,
        }));
        chatMessagesRef.current.set(convId, messages);
      });
    },
    [conversationToSlot, setMessagesSlots, bumpMessageListRevision],
  );
  setMessagesForConversationRef.current = setMessagesForConversation;

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
      cancelCoworkerDbSync(conversationId);
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

    if (isSelectedChatCoworker) {
      void syncCoworkerSlotFromDbWithRetry({
        conversationId: selectedChatId,
        slotMessages: msgs,
        getLiveSlotMessages: () =>
          getLiveSlotMessagesForConversationRef.current(selectedChatId),
        onApply: (dbMessages) => {
          setMessagesForConversation(selectedChatId, dbMessages, {
            forceFromDb: true,
          });
          chatMessagesRef.current.set(selectedChatId, dbMessages);
        },
      });
      return;
    }

    void selectConversation(selectedChatId);
  }, [
    selectedChatId,
    conversationToSlot,
    slotMessages,
    isSelectedChatLoading,
    isSelectedChatCoworker,
    selectConversation,
    setMessagesForConversation,
  ]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }
      const conversationId = selectedChatId;
      if (!conversationId || isSelectedChatLoading || !isSelectedChatCoworker) {
        return;
      }
      const liveMessages =
        getLiveSlotMessagesForConversationRef.current(conversationId);
      if (
        hasGoodCoworkerAssistantTail(liveMessages) &&
        !isStaleCoworkerAssistantTail(liveMessages)
      ) {
        bumpMessageListRevision();
        return;
      }
      void syncCoworkerSlotFromDbWithRetry({
        conversationId,
        slotMessages: liveMessages,
        getLiveSlotMessages: () =>
          getLiveSlotMessagesForConversationRef.current(conversationId),
        onApply: (dbMessages) => {
          setMessagesForConversation(conversationId, dbMessages, {
            forceFromDb: true,
          });
          chatMessagesRef.current.set(conversationId, dbMessages);
        },
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    selectedChatId,
    isSelectedChatLoading,
    isSelectedChatCoworker,
    setMessagesForConversation,
    bumpMessageListRevision,
  ]);

  const { selectChat: _selectChat } = useChatSelection({
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
    isSelectedChatStreaming: isSelectedChatLoading,
    isConversationLoading:
      Boolean(selectedChatId) && selectedConversation?.id !== selectedChatId,
    enabled: isRouteDriven,
  });

  const { updateChatPreview } = useChatPreview({ setChats });

  useEffect(() => {
    updateChatPreviewRef.current = updateChatPreview;
  }, [updateChatPreview]);

  useEffect(() => {
    if (!welcomeCreationInFlightRef.current || !selectedChatId) return;

    const pendingWelcome = pendingWelcomeSendRef.current;
    if (pendingWelcome?.conversationId === selectedChatId) {
      return;
    }
    if (pendingUrlConversationIdRef.current === selectedChatId) {
      return;
    }

    const slot = conversationToSlot.get(selectedChatId);
    if (slot === undefined) {
      return;
    }

    const status = slotStatuses[slot];
    if (
      status === "submitted" ||
      status === "streaming" ||
      status === "error"
    ) {
      welcomeCreationInFlightRef.current = false;
      return;
    }

    const messages = slotMessages[slot] as UIMessage[] | undefined;
    if (status === "ready" && (messages?.length ?? 0) > 0) {
      welcomeCreationInFlightRef.current = false;
    }
  }, [
    selectedChatId,
    conversationToSlot,
    slotStatuses,
    slotMessagesSignature,
    welcomeSendRetryTick,
  ]);

  const { cacheMessages: _cacheMessages, clearMessages: _clearMessages } =
    useChatMessages({
      selectedChatId,
      selectedConversation,
      setMessagesForConversation,
      previousChatIdRef,
      messagesChatIdRef,
      chatMessagesRef,
      streamingConversationIdsRef,
      welcomeCreationInFlightRef,
      pendingUrlConversationIdRef,
      isRouteDriven,
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

  const isCoworkerFirstTurn = useMemo(
    () => !hasGoodCoworkerAssistantTail(displayedMessages),
    [displayedMessages],
  );

  const { warmupPending, warmupState, warmupFailed } = useConversationWarmup({
    conversationId: selectedChatId,
    enabled: Boolean(
      selectedChatId && isSelectedChatCoworker && isCoworkerFirstTurn,
    ),
  });

  const {
    createCoworkerChat,
    isWelcomeTransitioning,
    setIsWelcomeTransitioning,
    showMessagesAfterTransition,
    setShowMessagesAfterTransition,
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
    isRouteDriven,
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

  const failPendingWelcomeSend = useCallback(
    (
      pending: NonNullable<(typeof pendingWelcomeSendRef)["current"]>,
      options?: { restoreInput?: boolean },
    ) => {
      if (options?.restoreInput !== false) {
        const text = getSendMessageText(pending.payload);
        if (text) {
          setInput(text);
        }
      }
      if (pendingUrlConversationIdRef.current === pending.conversationId) {
        pendingUrlConversationIdRef.current = null;
      }
      welcomeCreationInFlightRef.current = false;
      pendingWelcomeSendRef.current = null;
      toast.error(t("welcomeSendFailed"));
    },
    [setInput, t],
  );

  useEffect(() => {
    const pending = pendingWelcomeSendRef.current;
    if (!pending) return;

    const maxAgeMs = pending.isCoworker
      ? WELCOME_SEND_COWORKER_MAX_AGE_MS
      : WELCOME_SEND_MAX_AGE_MS;
    const elapsedMs = Date.now() - pending.createdAt;
    if (elapsedMs > maxAgeMs) {
      failPendingWelcomeSend(pending);
      return;
    }

    const pathConversationId = pathname
      ? getConversationIdFromChatPathname(pathname)
      : null;
    const routeReady =
      isRouteDriven &&
      (urlConversationId === pending.conversationId ||
        pathConversationId === pending.conversationId);
    const controlledReady =
      !isRouteDriven && selectedChatId === pending.conversationId;

    if (isRouteDriven && !routeReady) {
      if (!pending.navigationRequested) {
        pending.navigationRequested = true;
        pendingUrlConversationIdRef.current = pending.conversationId;
        isUpdatingUrlRef.current = true;
        const targetPath = `${CHAT_APP_ROUTE_PREFIX}/${pending.bucketSlug}/conversation/${pending.conversationId}`;
        router.push(targetPath, { scroll: false });
      }
      return;
    }

    if (!routeReady && !controlledReady) {
      return;
    }

    if (
      pending.isCoworker &&
      selectedChatId === pending.conversationId &&
      !isCoworkerWarmupReadyForWelcomeSend({ warmupState, warmupFailed })
    ) {
      return;
    }

    const sent = sendInConversation(
      pending.conversationId,
      pending.payload,
      pending.sendOptions,
    );
    if (!sent) {
      failPendingWelcomeSend(pending);
      return;
    }

    setInput("");
    pendingWelcomeSendRef.current = null;
  }, [
    urlConversationId,
    pathname,
    isRouteDriven,
    selectedChatId,
    sendInConversation,
    welcomeSendRetryTick,
    router,
    failPendingWelcomeSend,
    warmupState,
    warmupFailed,
  ]);

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
      options?: ChatComposeSubmitOptions,
    ): Promise<boolean> => {
      if (
        !hasSendMessageContent(message) ||
        isLoading ||
        isPendingWelcomeSendForConversation(
          pendingWelcomeSendRef.current,
          selectedChatId,
        ) ||
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
          let bucketSlug: string | null = null;

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
            welcomeCreationInFlightRef.current = false;
            return false;
          }
          const conversation = await createCoworkerChat(selectedCoworker, {
            deferNavigation: true,
          });
          if (conversation) {
            conversationId = conversation.id;
            bucketSlug =
              displaySlugFromMetadata(conversation.metadata ?? null) ||
              slugify(selectedCoworker.slug) ||
              slugify(selectedCoworker.name) ||
              `coworker-${selectedCoworker.id}`;
          }

          if (!conversationId || !bucketSlug) {
            setIsWelcomeTransitioning(false);
            welcomeCreationInFlightRef.current = false;
            return false;
          }

          setShowMessagesAfterTransition(true);
          setIsWelcomeTransitioning(false);
          pendingWelcomeSendRef.current = {
            conversationId,
            bucketSlug,
            isCoworker: true,
            payload: sendPayload,
            sendOptions,
            createdAt: Date.now(),
            navigationRequested: false,
          };
          queueMicrotask(() => {
            setWelcomeSendRetryTick((tick) => tick + 1);
          });
          for (const delayMs of WELCOME_SEND_RETRY_DELAYS_MS) {
            window.setTimeout(() => {
              setWelcomeSendRetryTick((tick) => tick + 1);
            }, delayMs);
          }
          return true;
        } finally {
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
      createCoworkerChat,
      isLoading,
      isWelcomeTransitioning,
      selectedChatId,
      selectedConversationImageGeneration,
      effectiveWelcomeCoworker,
      t,
      setIsWelcomeTransitioning,
      setShowMessagesAfterTransition,
      urlConversationId,
      pathname,
      setChats,
      setInput,
    ],
  );

  useEffect(() => {
    if (!isRouteDriven || !isChatPath || isConversationsLoading) {
      return;
    }

    const pending = readPendingCoworkerDirectMessage();
    if (!pending) {
      return;
    }

    if (!isPendingCoworkerDirectMessageFresh(pending)) {
      clearPendingCoworkerDirectMessage();
      return;
    }

    const pathBucketSlug = getBucketSlugFromChatPathname(pathname ?? "");
    if (
      pathBucketSlug &&
      !pendingCoworkerDirectMessageMatchesBucket(pending, {
        bucketSlug: pathBucketSlug,
      })
    ) {
      return;
    }

    const coworker =
      findCoworkerBySlugOrId(coworkers, pending.coworkerSlug) ??
      findCoworkerBySlugOrId(coworkers, pending.coworkerId);
    if (!coworker || !coworkerHasCapability(coworker, "chat")) {
      return;
    }

    const routeConversationId = getConversationIdFromChatPathname(
      pathname ?? "",
    );
    if (routeConversationId && selectedChatId !== routeConversationId) {
      return;
    }

    const pendingKey = `${pending.createdAt}:${pending.coworkerId}:${pending.content}`;
    if (pendingCoworkerDirectMessageKeyRef.current === pendingKey) {
      return;
    }

    pendingCoworkerDirectMessageKeyRef.current = pendingKey;
    void handleSendMessage(pending.content, coworker, undefined, {
      kind: "chat",
    }).then((sent) => {
      if (sent) {
        clearPendingCoworkerDirectMessage();
        return;
      }
      pendingCoworkerDirectMessageKeyRef.current = null;
    });
  }, [
    coworkers,
    handleSendMessage,
    isChatPath,
    isConversationsLoading,
    isRouteDriven,
    pathname,
    selectedChatId,
  ]);

  const selectedChatStatus = useMemo(() => {
    if (!selectedChatId) return "ready" as const;
    const slot = conversationToSlot.get(selectedChatId);
    if (slot === undefined) return "ready" as const;
    const status = slotStatuses[slot];
    if (status === "error" && coworkerResponseInProgress[selectedChatId]) {
      return "ready" as const;
    }
    return status;
  }, [
    selectedChatId,
    conversationToSlot,
    slotStatuses,
    coworkerResponseInProgress,
  ]);

  const sendMessageForInput = useCallback(
    (message?: ChatSendMessage) => {
      const cid = selectedChatId ?? currentChatIdRef.current;
      if (!cid) return Promise.resolve();
      if (
        isPendingWelcomeSendForConversation(pendingWelcomeSendRef.current, cid)
      ) {
        return Promise.resolve();
      }
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

  const isPendingWelcomeSendBlocked = isPendingWelcomeSendForConversation(
    pendingWelcomeSendRef.current,
    selectedChatId,
  );

  const coworkerWarmupUiPending =
    isSelectedChatCoworker &&
    isCoworkerFirstTurn &&
    !isLoading &&
    !userTailRecoveryLoading &&
    (warmupPending ||
      isPendingWelcomeSendBlocked ||
      (warmupState === null && !warmupFailed));

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
        // Match on slug as well as id. A coworker row that gets recreated keeps
        // its slug (which is globally unique) but takes a new id, so older
        // conversations carry a `coworker_id` that no longer resolves. Matching
        // by id alone dropped those to the synthetic object below, which lacks
        // the availability fields the composer needs.
        const fromList =
          coworkers.find((c) => c.id === coworkerId) ??
          (coworkerSlug
            ? coworkers.find((c) => c.slug === coworkerSlug)
            : undefined);
        if (fromList) return fromList;
        if (selectedChat?.coworker?.id === coworkerId) {
          return selectedChat.coworker;
        }
        if (!coworkerSlug) {
          return selectedChat?.coworker;
        }
        // Metadata carries identity but no availability fields, and
        // `coworkerCanChat` reads a missing `capabilities` array as "cannot
        // chat" — which made the composer drop this coworker and silently
        // re-address the message to the default one. An open conversation is
        // proof enough that it chats; a genuinely dead endpoint fails loudly on
        // send instead of quietly writing to someone else.
        return {
          id: coworkerId,
          slug: coworkerSlug,
          name: coworkerName,
          description: (meta?.coworker_description as string) ?? "",
          useCase: (meta?.coworker_useCase as string) ?? "",
          canChat: true,
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

  const selectedConversationForView = useMemo(() => {
    if (!selectedChatId) {
      return null;
    }
    if (selectedConversation?.id === selectedChatId) {
      return selectedConversation;
    }
    return (
      conversations.find(
        (conversation) => conversation.id === selectedChatId,
      ) ?? null
    );
  }, [conversations, selectedChatId, selectedConversation]);

  const selectedConversationMetadata =
    (selectedConversationForView?.metadata as Record<string, unknown> | null) ??
    null;
  const selectedConversationBucketKey = getBucketKeyFromMetadata(
    selectedConversationMetadata,
  );
  const selectedCoworkerConversations = useMemo(() => {
    if (!selectedConversationBucketKey.startsWith("coworker:")) {
      return [];
    }
    return conversations
      .filter((conversation) => {
        const meta =
          (conversation.metadata as Record<string, unknown> | null) ?? null;
        return getBucketKeyFromMetadata(meta) === selectedConversationBucketKey;
      })
      .toSorted(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [conversations, selectedConversationBucketKey]);
  const selectedCoworkerBucketSlug =
    displaySlugFromMetadata(selectedConversationMetadata) ||
    slugify(selectedChatCoworker?.slug ?? "") ||
    slugify(selectedChatCoworker?.name ?? "");
  const selectedCoworkerDisplayName =
    selectedChatCoworker?.name ??
    (selectedConversationMetadata?.coworker_name as string | undefined) ??
    selectedChat?.title ??
    t("coworkerNameFallback");
  const showCoworkerChatHeader = Boolean(
    selectedChatId &&
      isSelectedChatCoworker &&
      selectedChatCoworker &&
      selectedCoworkerBucketSlug &&
      selectedConversationBucketKey.startsWith("coworker:"),
  );
  const handleCreateSelectedCoworkerConversation = useCallback(async () => {
    if (!selectedChatCoworker) {
      return false;
    }
    const conversation = await createCoworkerChat(selectedChatCoworker);
    return conversation != null;
  }, [createCoworkerChat, selectedChatCoworker]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-visible rounded-lg">
      <div className="relative flex h-full min-h-0 w-full flex-col">
        {selectedChatId ? (
          <>
            {showCoworkerChatHeader && selectedChatCoworker ? (
              <CoworkerChatHeader
                bucketSlug={selectedCoworkerBucketSlug}
                conversations={selectedCoworkerConversations}
                currentConversationId={selectedChatId}
                displayName={selectedCoworkerDisplayName}
                onCreateConversation={handleCreateSelectedCoworkerConversation}
              />
            ) : null}
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
                    messages={messagesForMessageList}
                    onResendLastMessage={handleResendLastMessage}
                    userTailRecoveryFailed={userTailRecoveryFailed}
                    coworkerResponseInProgress={Boolean(
                      selectedChatId &&
                        coworkerResponseInProgress[selectedChatId],
                    )}
                    listRevision={messageListRevision}
                    warmupPending={coworkerWarmupUiPending}
                    warmupCoworkerName={selectedChatCoworker?.name}
                    hasTopHeader={showCoworkerChatHeader}
                    fullWidth={isSelectedChatCoworker}
                    leftAlignedUserMessages={isSelectedChatCoworker}
                    showSenderHeaders={isSelectedChatCoworker}
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
            {/* The composer stays mounted while the conversation loads, the way
                the channels view does. `isConversationLoading` is true until the
                selected id shows up in the client-loaded conversation list — and
                stays true indefinitely if it never does — so gating the input on
                it left the user looking at a chat with no way to type. */}
            <>
              {/* Fade is for the floating centred composer (above z-10). Coworker
                  full-width layout sits in the column like channels — the fade
                  would paint over the composer and muddy the toolbar. */}
              {isSelectedChatCoworker ? null : (
                <div
                  aria-hidden
                  className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-5 h-32 bg-linear-to-t to-transparent"
                />
              )}
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
                selectedChatCoworker={selectedChatCoworker}
                coworkers={coworkers}
                persistentImageGeneration={selectedConversationImageGeneration}
                fullWidth={isSelectedChatCoworker}
                submitBlocked={
                  coworkerWarmupUiPending ||
                  isPendingWelcomeSendBlocked ||
                  Boolean(
                    selectedChatId &&
                      coworkerResponseInProgress[selectedChatId],
                  )
                }
              />
            </>
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
