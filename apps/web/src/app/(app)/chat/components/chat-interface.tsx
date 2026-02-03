"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { MultimodalInput } from "@/components/chat/multimodal-input";
import type { Attachment } from "@/components/chat/preview-attachment";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Conversation } from "@/lib/actions/conversation";
import {
  addConversationItem,
  getConversationItems,
} from "@/lib/actions/conversation/core-api-actions";
import { cn } from "@/lib/utils";

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { useConversations } from "../hooks/use-conversations";
import ChatMessage from "./chat-message";
import type { ChatStatus, Coworker } from "./chat-sidebar";
import SelectCoworkerModal from "./select-coworker-modal";

interface Chat {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: string;
  lastMessageTime?: Date;
  status: ChatStatus;
  coworker?: Coworker;
  model?: { id: string; name: string };
}

interface ChatInterfaceProps {
  userImageUrl: string;
  userName?: string;
}

// Helper function to extract text content from a message
function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

  // Try content property first
  if (
    "content" in messageAny &&
    messageAny.content !== undefined &&
    messageAny.content !== null
  ) {
    const msgContent = messageAny.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const partObj = part as Record<string, unknown>;
            if (
              "text" in partObj &&
              partObj.text !== null &&
              partObj.text !== undefined
            ) {
              return String(partObj.text);
            }
            if (
              "content" in partObj &&
              partObj.content !== null &&
              partObj.content !== undefined
            ) {
              return String(partObj.content);
            }
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  // Try "parts" property (AI SDK v6 format)
  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const partObj = part as Record<string, unknown>;
          if (
            "text" in partObj &&
            partObj.text !== null &&
            partObj.text !== undefined
          ) {
            return String(partObj.text);
          }
          if (
            "content" in partObj &&
            partObj.content !== null &&
            partObj.content !== undefined
          ) {
            return String(partObj.content);
          }
          // Try direct stringification if it's a simple object
          if (
            "type" in partObj &&
            partObj.type === "text" &&
            "text" in partObj
          ) {
            return String(partObj.text);
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  // Fallback: try "text" property directly
  if (
    !content &&
    "text" in messageAny &&
    messageAny.text !== undefined &&
    messageAny.text !== null
  ) {
    content = String(messageAny.text);
  }

  return content.trim();
}

// Helper function to generate suggestions based on coworker ID
function getCoworkerSuggestions(coworkerId?: string): string[] {
  if (!coworkerId) return [];

  const suggestionMap: Record<string, string[]> = {
    hannah: [
      "How can I analyze data effectively?",
      "What are the best practices for data visualization?",
      "How do I identify trends in my data?",
      "What statistical methods should I use?",
    ],
    john: [
      "How can I improve my code quality?",
      "What are common debugging techniques?",
      "How do I write more maintainable code?",
      "What's the best way to structure my project?",
    ],
    demosthenes: [
      "How can I write more clearly?",
      "What makes a good professional email?",
      "How do I structure a compelling proposal?",
      "What are tips for better business writing?",
    ],
  };

  return suggestionMap[coworkerId] || [];
}

// Welcome screen component for when user has no chats
function WelcomeScreen({
  userName,
  onSendMessage,
  isLoading,
  isTransitioning,
  input,
  setInput,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
}: {
  userName?: string;
  onSendMessage: (message: string, coworker?: Coworker) => void;
  isLoading: boolean;
  isTransitioning: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  attachments: Attachment[];
  setAttachments: (
    attachments: Attachment[] | ((prev: Attachment[]) => Attachment[]),
  ) => void;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  status: "ready" | "streaming" | "submitted" | "error";
  stop: () => void;
}) {
  const t = useTranslations("App.Chat.Chat");

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="mt-[-200px] flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="mb-2 text-3xl font-medium">
          {userName
            ? t("welcomeScreen.greetingWithName", { name: userName })
            : t("welcomeScreen.greeting")}
        </h1>
        <p className="text-muted-foreground text-2xl">
          {t("welcomeScreen.question")}
        </p>
      </div>
      <div className="bg-background/80 absolute right-0 bottom-0 left-0 z-10 flex shrink-0 justify-center px-4 py-2 backdrop-blur-sm">
        <div className="w-full max-w-[33.6rem]">
          <MultimodalInput
            input={input}
            setInput={setInput}
            status={status}
            stop={stop}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            onSendMessage={onSendMessage}
            showSuggestedActions={true}
          />
        </div>
      </div>
    </div>
  );
}

export default function ChatInterface({
  userImageUrl,
  userName,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Chat.Chat");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlConversationId = searchParams?.get("conversationId");
  const {
    conversations,
    selectedConversation,
    createNewConversation,
    selectConversation,
    deleteConversationById,
  } = useConversations();

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    urlConversationId || null,
  );
  const [input, setInput] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false);
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Ref to track selected model for use in prepareSendMessagesRequest
  const selectedModelRef = useRef<{ id: string; name: string } | null>(null);
  const [showMessagesAfterTransition, setShowMessagesAfterTransition] =
    useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Store messages per chat ID (in-memory cache)
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const previousChatIdRef = useRef<string | null>(null);
  // Ref to track current chat ID for use in prepareSendMessagesRequest (synchronous access)
  const currentChatIdRef = useRef<string | null>(null);
  // Track which conversations we've already fetched items for to populate previews
  const fetchedPreviewConversationIds = useRef<Set<string>>(new Set());

  // Helper to convert ConversationItem[] to UIMessage format
  const convertItemsToMessages = useCallback(
    (
      items: Array<{
        id: string;
        role: string;
        content: Array<{ type: string; text?: string }> | string;
        created_at: number;
      }>,
    ) => {
      return items.map((item) => {
        const contentText =
          typeof item.content === "string"
            ? item.content
            : item.content.map((c) => c.text || "").join("");
        return {
          id: item.id,
          role: item.role,
          parts: [{ type: "text", text: contentText }],
          content: contentText,
          createdAt: new Date(item.created_at * 1000),
        };
      });
    },
    [],
  );

  // Function to update chat preview with assistant message
  const updateChatPreview = useCallback(
    (chatId: string, content: string, isFirstMessage = false) => {
      if (!content || !content.trim()) {
        return;
      }

      const now = new Date();
      setChats((prev) => {
        return prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              ...(isFirstMessage && {
                title: content.slice(0, 50) || t("newChat"),
              }),
              lastMessage: content,
              lastMessageTime: now,
              updatedAt: now,
              status: "active" as ChatStatus,
            };
          }
          return chat;
        });
      });
    },
    [selectedChatId, t],
  );

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        // Use ref for synchronous access to current chat ID
        const chatId = currentChatIdRef.current || selectedChatId;
        const model = selectedModelRef.current;
        const body = {
          messages: request.messages,
          ...(chatId ? { conversationId: chatId } : {}),
          ...(model ? { model: model.id } : {}),
          ...request.body,
        };
        return { body };
      },
    }),
    onError: (error) => {
      console.error("Chat API error:", error);
    },
    onFinish: ({ messages: finishedMessages }) => {
      if (!selectedChatId || finishedMessages.length === 0) {
        return;
      }

      // CRITICAL: Only update preview if messages belong to the currently selected chat
      // This prevents updating the wrong chat's preview when switching between chats
      if (previousChatIdRef.current !== selectedChatId) {
        // Messages don't belong to the selected chat, skip preview update
        return;
      }

      // CRITICAL: Verify messages actually belong to this chat using messagesChatIdRef
      if (messagesChatIdRef.current !== selectedChatId) {
        // Messages belong to a different chat, skip preview update
        return;
      }

      // Find the last assistant message
      const lastAssistantMessage = [...finishedMessages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      if (lastAssistantMessage) {
        const content = extractMessageContent(lastAssistantMessage);
        if (content) {
          const isFirstAssistantMessage =
            finishedMessages.filter((m) => m.role === "assistant").length === 1;
          updateChatPreview(selectedChatId, content, isFirstAssistantMessage);

          // Save assistant message to database via Core API
          // Format as Responses API output_text array: [{"type": "output_text", "text": "..."}]
          const formattedContent: Array<{ type: string; text: string }> =
            content ? [{ type: "output_text", text: content }] : [];

          addConversationItem({
            conversationId: selectedChatId,
            role: "assistant",
            content: formattedContent,
          }).catch((error) => {
            console.error(
              "Failed to add assistant message to conversation via Core API:",
              error,
            );
          });
        }
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Helper function to format date for day separators
  const formatDaySeparator = useCallback((date: Date): string => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );

    // Check if it's today
    if (
      messageDate.getTime() === today.getTime() &&
      messageDate.getMonth() === today.getMonth() &&
      messageDate.getFullYear() === today.getFullYear()
    ) {
      return "Today";
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if it's yesterday
    if (
      messageDate.getTime() === yesterday.getTime() &&
      messageDate.getMonth() === yesterday.getMonth() &&
      messageDate.getFullYear() === yesterday.getFullYear()
    ) {
      return "Yesterday";
    }

    // Check if it's within the last week
    const daysDiff = Math.floor(
      (today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff < 7) {
      // Return day of the week
      const daysOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      return daysOfWeek[messageDate.getDay()];
    }

    // Format as dd/mm/yyyy
    const day = String(messageDate.getDate()).padStart(2, "0");
    const month = String(messageDate.getMonth() + 1).padStart(2, "0");
    const year = messageDate.getFullYear();
    return `${day}/${month}/${year}`;
  }, []);

  // Helper function to check if two dates are on different days
  const isDifferentDay = useCallback(
    (date1: Date | undefined, date2: Date | undefined): boolean => {
      if (!date1 || !date2) return false;

      const d1 = new Date(
        date1.getFullYear(),
        date1.getMonth(),
        date1.getDate(),
      );
      const d2 = new Date(
        date2.getFullYear(),
        date2.getMonth(),
        date2.getDate(),
      );

      return d1.getTime() !== d2.getTime();
    },
    [],
  );

  // Add timestamps to messages that don't have them
  const messagesWithTimestamps = messages.map((message) => {
    if ("createdAt" in message && message.createdAt) {
      return message;
    }
    return {
      ...message,
      createdAt: new Date(),
    };
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current?.querySelector(
          '[data-slot="scroll-area-viewport"]',
        ) as HTMLElement | null;
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };

    // Scroll immediately
    scrollToBottom();

    // Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      scrollToBottom();
    });

    // During streaming, continuously scroll to bottom more aggressively
    if (isLoading) {
      const interval = setInterval(() => {
        scrollToBottom();
      }, 50); // Check every 50ms during streaming for smoother updates

      return () => clearInterval(interval);
    }
  }, [messages, isLoading, selectedChatId]);

  // Also use MutationObserver to catch DOM changes during streaming
  useEffect(() => {
    if (!scrollAreaRef.current || !isLoading) return;

    const scrollContainer = scrollAreaRef.current?.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;

    if (!scrollContainer) return;

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };

    const observer = new MutationObserver(() => {
      requestAnimationFrame(scrollToBottom);
    });

    observer.observe(scrollContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [isLoading]);

  // Update chat preview when assistant messages are added/updated (during streaming)
  useEffect(() => {
    if (!selectedChatId || messages.length === 0) {
      return;
    }

    // CRITICAL: Only update preview if messages belong to the currently selected chat
    // This prevents updating the wrong chat's preview when switching between chats
    if (previousChatIdRef.current !== selectedChatId) {
      // Messages don't belong to the selected chat yet, skip preview update
      return;
    }

    // CRITICAL: Verify messages actually belong to this chat using messagesChatIdRef
    // This prevents race conditions when switching chats quickly
    if (messagesChatIdRef.current !== selectedChatId) {
      return;
    }

    // Verify messages belong to the selected chat by checking if the chat ID is tracked
    // For new chats, chatMessagesRef will have an entry (even if empty array), so we check if the key exists
    if (!chatMessagesRef.current.has(selectedChatId)) {
      // Chat not yet initialized in memory, skip preview update
      return;
    }

    // Find the last assistant message
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === "assistant");

    if (lastAssistantMessage) {
      const content = extractMessageContent(lastAssistantMessage);
      if (content) {
        // Check if this content is different from what's currently stored
        const currentChat = chats.find((c) => c.id === selectedChatId);
        if (!currentChat || currentChat.lastMessage !== content) {
          const isFirstAssistantMessage =
            messages.filter((m) => m.role === "assistant").length === 1;
          // Use requestAnimationFrame to batch the state update
          requestAnimationFrame(() => {
            updateChatPreview(selectedChatId, content, isFirstAssistantMessage);
          });
        }
      }
    }
  }, [messages, selectedChatId, chats, updateChatPreview]);

  // Note: Messages are now fetched from DB when selecting a conversation
  // No need to preload from localStorage since DB is the source of truth
  // Welcome view is always shown by default - chats are only selected when user explicitly clicks on them

  // Reset transition state when chats are loaded
  useEffect(() => {
    if (
      chats.length > 0 &&
      conversations.length > 0 &&
      isWelcomeTransitioning
    ) {
      // Hide messages during transition to prevent layout shifts
      setShowMessagesAfterTransition(false);

      // Show messages after animation completes (300ms delay + 500ms duration = 800ms)
      const showTimer = setTimeout(() => {
        setShowMessagesAfterTransition(true);
      }, 800);

      // Reset transition state after animation completes
      const resetTimer = setTimeout(() => {
        setIsWelcomeTransitioning(false);
      }, 200);

      return () => {
        clearTimeout(showTimer);
        clearTimeout(resetTimer);
      };
    } else if (!isWelcomeTransitioning) {
      // Ensure messages are shown when not transitioning
      setShowMessagesAfterTransition(true);
    }
  }, [chats.length, conversations.length, isWelcomeTransitioning]);

  // Sync conversations from DB to chats state
  useEffect(() => {
    if (conversations.length === 0 && chats.length === 0) {
      return; // Don't clear chats if conversations haven't loaded yet
    }

    requestAnimationFrame(() => {
      const mappedChats: Chat[] = conversations.map((conv: Conversation) => {
        const metadata = conv.metadata as Record<string, unknown> | null;
        const coworkerId = metadata?.coworker_id as string | undefined;
        const coworkerName = metadata?.coworker_name as string | undefined;
        const modelId = metadata?.model_id as string | undefined;
        const modelName = metadata?.model_name as string | undefined;
        const conversationType = metadata?.type as string | undefined;

        // Find existing chat to preserve UI state (lastMessage, etc.)
        const existingChat = chats.find((c) => c.id === conv.id);

        // Build coworker object from metadata or existing chat
        let coworker: Coworker | undefined;
        if (existingChat?.coworker) {
          coworker = existingChat.coworker;
        } else if (
          coworkerId &&
          coworkerName &&
          conversationType === "coworker"
        ) {
          // For new conversations, we need to get full coworker info
          // For now, create a minimal coworker - the full info will be preserved from handleCoworkerSelected
          coworker = {
            id: coworkerId,
            name: coworkerName,
            description: "", // Will be filled from existing chat if available
            useCase: "", // Will be filled from existing chat if available
          };
        }

        // Load model info if this is a model conversation
        if (
          conversationType === "model" &&
          modelId &&
          modelName &&
          conv.id === selectedChatId
        ) {
          setSelectedModel({ id: modelId, name: modelName });
          selectedModelRef.current = { id: modelId, name: modelName };
        } else if (
          conversationType === "coworker" &&
          conv.id === selectedChatId
        ) {
          // Clear model selection for coworker conversations
          setSelectedModel(null);
          selectedModelRef.current = null;
        }

        // Build model object from metadata
        let model: { id: string; name: string } | undefined;
        if (conversationType === "model" && modelId && modelName) {
          model = { id: modelId, name: modelName };
        }

        // Get lastMessage from existing chat (preserved from previous state)
        // Note: Last message will be updated when messages are loaded from DB
        const lastMessage = existingChat?.lastMessage;
        const lastMessageTime = existingChat?.lastMessageTime;

        return {
          id: conv.id,
          title: conv.title || coworkerName || modelName || t("newChat"),
          createdAt: new Date(conv.createdAt),
          updatedAt: new Date(conv.updatedAt),
          status: (existingChat?.status || "active") as ChatStatus,
          coworker,
          model,
          lastMessage,
          lastMessageTime,
        };
      });

      // Check if we need to update (avoid infinite loops)
      const needsUpdate =
        mappedChats.length !== chats.length ||
        mappedChats.some(
          (chat, index) =>
            chat.id !== chats[index]?.id ||
            chat.updatedAt.getTime() !== chats[index]?.updatedAt.getTime(),
        );

      if (needsUpdate) {
        setChats(mappedChats);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, t]); // Don't include chats in deps to avoid infinite loop

  // Fetch items for conversations to populate previews when conversations are loaded
  useEffect(() => {
    if (conversations.length === 0) {
      return;
    }

    // Fetch items for all conversations that haven't been fetched yet
    // This runs when conversations are loaded to populate previews automatically
    conversations.forEach((conv) => {
      // Skip if we've already fetched items for this conversation
      if (fetchedPreviewConversationIds.current.has(conv.id)) {
        return;
      }

      // Mark as fetching to avoid duplicate requests
      fetchedPreviewConversationIds.current.add(conv.id);

      // Fetch items for this conversation to populate preview
      void getConversationItems({ conversationId: conv.id })
        .then((rawResult: unknown) => {
          // Parse the serialized Result from server action
          type SerializedResult =
            | {
                ok: true;
                data: Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  created_at: number;
                }>;
              }
            | { ok: false; error: unknown }
            | { isOk: () => boolean; value?: unknown };
          const resultAny = rawResult as SerializedResult;
          let items: Array<{
            id: string;
            role: string;
            content: Array<{ type: string; text?: string }> | string;
            created_at: number;
          }> | null = null;

          if (
            resultAny &&
            "ok" in resultAny &&
            resultAny.ok === true &&
            "data" in resultAny
          ) {
            items = resultAny.data;
          } else if (
            resultAny &&
            "isOk" in resultAny &&
            typeof resultAny.isOk === "function"
          ) {
            // It's a proper neverthrow Result (shouldn't happen after serialization, but handle it)
            if (resultAny.isOk() && "value" in resultAny) {
              items = resultAny.value as Array<{
                id: string;
                role: string;
                content: Array<{ type: string; text?: string }> | string;
                created_at: number;
              }>;
            }
          }

          if (items && items.length > 0) {
            // Find the last assistant message
            const lastAssistantItem = items
              .slice()
              .reverse()
              .find((item) => item.role === "assistant");
            if (lastAssistantItem) {
              const lastMessageContent =
                typeof lastAssistantItem.content === "string"
                  ? lastAssistantItem.content
                  : lastAssistantItem.content.map((c) => c.text || "").join("");
              if (lastMessageContent) {
                updateChatPreview(conv.id, lastMessageContent, false);
              }
            }
          }
        })
        .catch((error) => {
          // If fetch fails, remove from fetched set so we can retry later
          fetchedPreviewConversationIds.current.delete(conv.id);
          console.error(
            `Failed to fetch items for conversation ${conv.id}:`,
            error,
          );
        });
    });
    // Fetch items when conversations are loaded
    // The ref prevents duplicate fetches, so we can safely fetch for all conversations
  }, [conversations, updateChatPreview]); // updateChatPreview is stable (doesn't depend on chats)

  const handleCreateNewChat = useCallback(() => {
    setShowSelectCoworkerModal(true);
  }, []);

  const handleModelSelected = useCallback(
    async (model: { id: string; name: string } | null) => {
      if (!model) {
        setSelectedModel(null);
        selectedModelRef.current = null;
        return;
      }
      // Create conversation with model metadata
      const conversation = await createNewConversation(
        {
          model_id: model.id,
          model_name: model.name,
          type: "model", // Mark as model conversation
        },
        model.name,
      );

      if (!conversation) {
        return; // Error handling is done in the hook
      }

      // Initialize empty messages for new chat
      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id;
      messagesChatIdRef.current = conversation.id;
      setMessages([]);
      setInput("");

      // Add to chats list
      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || model.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker: undefined, // No coworker for model conversations
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
      isUpdatingUrlRef.current = true;
      router.push(`/chat?conversationId=${conversation.id}`, { scroll: false });
    },
    [
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      router,
    ],
  );

  const handleCoworkerSelected = useCallback(
    async (coworker: Coworker) => {
      // Clear model selection when selecting coworker
      setSelectedModel(null);
      selectedModelRef.current = null;

      // Create conversation and store in DB
      const conversation = await createNewConversation(
        {
          coworker_id: coworker.id,
          coworker_name: coworker.name,
          coworker_description: coworker.description,
          coworker_useCase: coworker.useCase,
          type: "coworker", // Mark as coworker conversation
        },
        coworker.name,
      );

      if (!conversation) {
        return; // Error handling is done in the hook
      }

      // Initialize empty messages for new chat
      chatMessagesRef.current.set(conversation.id, []);
      previousChatIdRef.current = conversation.id; // Set ref immediately to prevent preview updates
      messagesChatIdRef.current = conversation.id; // Track that messages belong to this chat
      setMessages([]);
      setInput("");

      // Temporarily add to chats with full coworker info so sync effect can preserve it
      // The sync effect will update it properly when conversations state updates
      const tempChat: Chat = {
        id: conversation.id,
        title: conversation.title || coworker.name,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        status: "active",
        coworker,
      };
      setChats((prev) => {
        // Check if already exists (from sync effect)
        if (prev.find((c) => c.id === conversation.id)) {
          return prev.map((c) =>
            c.id === conversation.id ? { ...c, coworker } : c,
          );
        }
        return [tempChat, ...prev];
      });

      setSelectedChatId(conversation.id);
      // Update ref immediately for synchronous access in prepareSendMessagesRequest
      currentChatIdRef.current = conversation.id;
      // Update URL to reflect selected conversation using router for consistency
      isUpdatingUrlRef.current = true;
      router.push(`/chat?conversationId=${conversation.id}`, { scroll: false });
    },
    [
      createNewConversation,
      setMessages,
      setInput,
      setChats,
      setSelectedChatId,
      router,
    ],
  );

  // Track which chat ID the current messages belong to
  const messagesChatIdRef = useRef<string | null>(null);

  // Load messages from database when switching chats
  useEffect(() => {
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;

      // Clear messages immediately and mark as belonging to no chat
      messagesChatIdRef.current = null;
      setMessages([]);

      // Set ref AFTER clearing messages to prevent preview updates with wrong messages
      previousChatIdRef.current = currentSelectedChatId;

      // Fetch messages from database (source of truth)
      const loadMessagesFromDB = async () => {
        // Only proceed if we're still on the same chat (user didn't switch again)
        if (selectedChatId !== currentSelectedChatId) {
          return;
        }

        try {
          // Check in-memory cache first (for performance)
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(cachedMessages as Parameters<typeof setMessages>[0]);
          }

          // Always fetch from DB to ensure we have the latest data
          // This ensures DB is the source of truth
          const rawItemsResult: unknown = await getConversationItems({
            conversationId: currentSelectedChatId,
          });

          // Parse the serialized Result from server action
          type SerializedResult =
            | {
                ok: true;
                data: Array<{
                  id: string;
                  role: string;
                  content: Array<{ type: string; text?: string }> | string;
                  created_at: number;
                }>;
              }
            | { ok: false; error: unknown }
            | { isOk: () => boolean; value?: unknown };
          const resultAny = rawItemsResult as SerializedResult;
          let items: Array<{
            id: string;
            role: string;
            content: Array<{ type: string; text?: string }> | string;
            created_at: number;
          }> | null = null;

          if (
            resultAny &&
            "ok" in resultAny &&
            resultAny.ok === true &&
            "data" in resultAny
          ) {
            items = resultAny.data;
          } else if (
            resultAny &&
            "isOk" in resultAny &&
            typeof resultAny.isOk === "function"
          ) {
            // It's a proper neverthrow Result (shouldn't happen after serialization, but handle it)
            if (resultAny.isOk() && "value" in resultAny) {
              items = resultAny.value as Array<{
                id: string;
                role: string;
                content: Array<{ type: string; text?: string }> | string;
                created_at: number;
              }>;
            }
          }

          if (items && items.length > 0) {
            const dbMessages = convertItemsToMessages(items);
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(
              dbMessages as unknown as Parameters<typeof setMessages>[0],
            );
            // Update cache with fresh data from DB
            chatMessagesRef.current.set(currentSelectedChatId, dbMessages);

            // Extract last assistant message and update chat preview
            const lastAssistantItem = items
              .slice()
              .reverse()
              .find((item) => item.role === "assistant");
            if (lastAssistantItem) {
              const lastMessageContent =
                typeof lastAssistantItem.content === "string"
                  ? lastAssistantItem.content
                  : lastAssistantItem.content.map((c) => c.text || "").join("");
              if (lastMessageContent) {
                updateChatPreview(
                  currentSelectedChatId,
                  lastMessageContent,
                  false,
                );
              }
            }
          } else if (!cachedMessages) {
            // No cache and DB fetch failed - start fresh
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages([]);
          }
        } catch (error) {
          console.error("Failed to load messages from database:", error);
          // Fallback to cache if available
          const cachedMessages = chatMessagesRef.current.get(
            currentSelectedChatId,
          );
          if (cachedMessages && cachedMessages.length > 0) {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages(cachedMessages as Parameters<typeof setMessages>[0]);
          } else {
            messagesChatIdRef.current = currentSelectedChatId;
            setMessages([]);
          }
        }
      };

      // Small delay to ensure messages are cleared before loading
      const timeoutId = setTimeout(() => {
        void loadMessagesFromDB();
      }, 0);

      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      previousChatIdRef.current = null;
      messagesChatIdRef.current = null;
      setMessages([]);
    }
  }, [selectedChatId, setMessages, convertItemsToMessages, updateChatPreview]);

  // Also reload messages when selectedConversation updates (in case it loads after selectedChatId is set)
  useEffect(() => {
    if (
      selectedChatId &&
      selectedConversation?.id === selectedChatId &&
      selectedConversation.items &&
      selectedConversation.items.length > 0
    ) {
      // Check if we already have messages loaded
      const currentMessages = chatMessagesRef.current.get(selectedChatId);
      if (currentMessages && currentMessages.length > 0) {
        // Already loaded, skip
        return;
      }

      // Convert ConversationItem[] to UIMessage format
      const dbMessages = convertItemsToMessages(selectedConversation.items);
      messagesChatIdRef.current = selectedChatId; // Track that messages belong to this chat
      setMessages(dbMessages as unknown as Parameters<typeof setMessages>[0]);
      // Update cache with data from DB
      chatMessagesRef.current.set(selectedChatId, dbMessages);

      // Extract last assistant message and update chat preview
      const lastAssistantItem = selectedConversation.items
        .slice()
        .reverse()
        .find((item) => item.role === "assistant");
      if (lastAssistantItem) {
        const lastMessageContent =
          typeof lastAssistantItem.content === "string"
            ? lastAssistantItem.content
            : lastAssistantItem.content.map((c) => c.text || "").join("");
        if (lastMessageContent) {
          updateChatPreview(selectedChatId, lastMessageContent, false);
        }
      }

      previousChatIdRef.current = selectedChatId;
    }
  }, [
    selectedConversation,
    selectedChatId,
    setMessages,
    convertItemsToMessages,
    updateChatPreview,
  ]);

  // Update in-memory cache whenever messages change for the current chat
  // Note: Messages are persisted to DB via addConversationItem, so we only cache here
  useEffect(() => {
    if (
      selectedChatId &&
      previousChatIdRef.current === selectedChatId &&
      messagesChatIdRef.current === selectedChatId &&
      messages.length > 0
    ) {
      // Update cache for performance (DB is source of truth)
      chatMessagesRef.current.set(selectedChatId, messages);
    }
  }, [messages, selectedChatId]);

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
  // Use a ref to track if we're updating the URL ourselves to prevent loops
  const isUpdatingUrlRef = useRef(false);

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

  const handleDeleteChat = async (chatId: string) => {
    // Delete from DB (works for any conversation, not just the selected one)
    await deleteConversationById(chatId);

    // If this was the selected conversation, clear selection and messages
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      currentChatIdRef.current = null;
      setMessages([]);
      setInput("");
    }

    // Remove from local state and cache
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    chatMessagesRef.current.delete(chatId);
  };

  const handleSendMessage = useCallback(
    async (
      messageText: string,
      coworker?: Coworker,
      model?: { id: string; name: string },
    ) => {
      if (!messageText.trim() || isLoading) return;

      const trimmedMessage = messageText.trim();

      // If no chat is selected, create one with the selected model or coworker
      if (!selectedChatId) {
        // Start transition animation
        setIsWelcomeTransitioning(true);

        // Wait for welcome screen fade-out to complete before showing chat UI
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Check if a model is selected, otherwise use coworker
        if (model || selectedModel) {
          const modelToUse = model || selectedModel;
          if (modelToUse) {
            await handleModelSelected(modelToUse);
          }
        } else {
          // Use provided coworker or default to Hannah
          const selectedCoworker: Coworker = coworker || {
            id: "hannah",
            name: t("coworkers.hannah.name"),
            description: t("coworkers.hannah.description"),
            useCase: t("coworkers.hannah.useCase"),
          };
          await handleCoworkerSelected(selectedCoworker);
        }

        // Wait for state to update and ensure conversation ID is set
        const conversationId = currentChatIdRef.current;
        if (!conversationId) {
          // Wait a bit more and retry
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Scroll to bottom before sending message to make room for response
        const scrollToBottom = () => {
          if (scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current?.querySelector(
              '[data-slot="scroll-area-viewport"]',
            ) as HTMLElement | null;
            if (scrollContainer) {
              scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
          }
        };
        scrollToBottom();
        requestAnimationFrame(() => {
          scrollToBottom();
        });

        // Now send the message
        sendMessage({ text: trimmedMessage });
        setInput("");
        return;
      }

      // Only update timestamp when user sends message, don't update lastMessage
      // The lastMessage will be updated by useEffect or onFinish when assistant responds
      if (selectedChatId) {
        const now = new Date();
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === selectedChatId
              ? {
                  ...chat,
                  updatedAt: now,
                  status: "active" as ChatStatus,
                }
              : chat,
          ),
        );
      }

      // Scroll to bottom before sending message to make room for response
      const scrollToBottom = () => {
        if (scrollAreaRef.current) {
          const scrollContainer = scrollAreaRef.current?.querySelector(
            '[data-slot="scroll-area-viewport"]',
          ) as HTMLElement | null;
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }
      };
      scrollToBottom();
      requestAnimationFrame(() => {
        scrollToBottom();
      });

      sendMessage({ text: trimmedMessage });
      setInput("");
    },
    [
      isLoading,
      selectedChatId,
      chats.length,
      sendMessage,
      setInput,
      handleCreateNewChat,
      handleCoworkerSelected,
      handleModelSelected,
      selectedModel,
      t,
    ],
  );

  const handleInputSubmit = () => {
    handleSendMessage(input);
  };

  const handleStop = () => {
    stop();
  };

  // Hide sidebar when messages exist, show full-width chat interface
  const hasActiveChat = selectedChatId && messages.length > 0;

  // Get the selected chat's coworker for MultimodalInput
  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const selectedChatCoworker = selectedChat?.coworker;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg">
      <div className="relative flex h-full min-h-0 w-full flex-col">
        {selectedChatId && hasActiveChat ? (
          <>
            {showMessagesAfterTransition && (
              <div className="absolute inset-x-0 top-0 bottom-[100px] overflow-hidden">
                <ScrollArea ref={scrollAreaRef} className="h-full w-full">
                  <div className="flex flex-col items-center pt-4 pb-20">
                    <div className="flex w-full max-w-4xl flex-col">
                      {messagesWithTimestamps.map((message, index) => {
                        const role = message.role as "user" | "assistant";

                        // Get createdAt for current message
                        let currentCreatedAt: Date | undefined;
                        if ("createdAt" in message) {
                          const createdAtValue = message.createdAt;
                          if (createdAtValue instanceof Date) {
                            currentCreatedAt = createdAtValue;
                          } else if (
                            typeof createdAtValue === "string" ||
                            typeof createdAtValue === "number"
                          ) {
                            currentCreatedAt = new Date(createdAtValue);
                          }
                        }

                        // Get createdAt for previous message
                        let previousCreatedAt: Date | undefined;
                        if (index > 0) {
                          const prevMessage = messagesWithTimestamps[index - 1];
                          if ("createdAt" in prevMessage) {
                            const createdAtValue = prevMessage.createdAt;
                            if (createdAtValue instanceof Date) {
                              previousCreatedAt = createdAtValue;
                            } else if (
                              typeof createdAtValue === "string" ||
                              typeof createdAtValue === "number"
                            ) {
                              previousCreatedAt = new Date(createdAtValue);
                            }
                          }
                        }

                        // Check if we need to show a day separator
                        const showDaySeparator =
                          index === 0 ||
                          (currentCreatedAt &&
                            isDifferentDay(
                              currentCreatedAt,
                              previousCreatedAt,
                            ));
                        // Extract content from message - AI SDK v6 format
                        let content = "";

                        const messageAny = message as Record<string, unknown>;

                        // 1. Try content property (most common for AI SDK)
                        if (
                          "content" in messageAny &&
                          messageAny.content !== undefined &&
                          messageAny.content !== null
                        ) {
                          const msgContent = messageAny.content;
                          if (typeof msgContent === "string") {
                            content = msgContent;
                          } else if (Array.isArray(msgContent)) {
                            // Content is an array of parts - extract text from each part
                            content = msgContent
                              .map((part: unknown) => {
                                if (typeof part === "string") return part;
                                if (part && typeof part === "object") {
                                  const partObj = part as Record<
                                    string,
                                    unknown
                                  >;
                                  // Try text property first
                                  if (
                                    "text" in partObj &&
                                    partObj.text !== null &&
                                    partObj.text !== undefined
                                  ) {
                                    return String(partObj.text);
                                  }
                                  // Try type: "text" with text property
                                  if (
                                    "type" in partObj &&
                                    partObj.type === "text" &&
                                    "text" in partObj &&
                                    partObj.text !== null &&
                                    partObj.text !== undefined
                                  ) {
                                    return String(partObj.text);
                                  }
                                  // Try content property within part
                                  if (
                                    "content" in partObj &&
                                    partObj.content !== null &&
                                    partObj.content !== undefined
                                  ) {
                                    return String(partObj.content);
                                  }
                                }
                                return "";
                              })
                              .filter(Boolean)
                              .join("");
                          } else if (
                            msgContent &&
                            typeof msgContent === "object"
                          ) {
                            const contentObj = msgContent as Record<
                              string,
                              unknown
                            >;
                            if ("text" in contentObj) {
                              content = String(contentObj.text);
                            } else {
                              content = JSON.stringify(contentObj);
                            }
                          } else if (
                            msgContent !== null &&
                            msgContent !== undefined
                          ) {
                            content = String(msgContent);
                          }
                        }

                        // 2. Try text property (for user messages sent via sendMessage)
                        if (
                          !content &&
                          "text" in messageAny &&
                          messageAny.text !== undefined &&
                          messageAny.text !== null
                        ) {
                          content = String(messageAny.text);
                        }

                        // 3. Try parts array
                        if (
                          !content &&
                          "parts" in messageAny &&
                          Array.isArray(messageAny.parts)
                        ) {
                          content = (messageAny.parts as unknown[])
                            .map((part: unknown) => {
                              if (typeof part === "string") return part;
                              if (part && typeof part === "object") {
                                const partObj = part as Record<string, unknown>;
                                if ("text" in partObj)
                                  return String(partObj.text);
                              }
                              return "";
                            })
                            .filter(Boolean)
                            .join("");
                        }

                        // 4. For user messages, check if the message itself is a string (edge case)
                        if (
                          !content &&
                          role === "user" &&
                          typeof message === "string"
                        ) {
                          content = message;
                        }

                        let createdAt: Date | undefined;
                        if ("createdAt" in message) {
                          const createdAtValue = message.createdAt;
                          if (createdAtValue instanceof Date) {
                            createdAt = createdAtValue;
                          } else if (
                            typeof createdAtValue === "string" ||
                            typeof createdAtValue === "number"
                          ) {
                            createdAt = new Date(createdAtValue);
                          }
                        }
                        const selectedChat = chats.find(
                          (c) => c.id === selectedChatId,
                        );
                        const coworkerName = selectedChat?.coworker?.name;
                        const modelName = selectedChat?.model?.name;
                        const modelId = selectedChat?.model?.id;

                        return (
                          <div key={message.id}>
                            {showDaySeparator && currentCreatedAt && (
                              <div className="flex items-center justify-center py-4">
                                <span className="text-muted-foreground rounded-full bg-gray-200 px-3 py-1 text-xs font-medium dark:bg-gray-900">
                                  {formatDaySeparator(currentCreatedAt)}
                                </span>
                              </div>
                            )}
                            <div className="mb-1">
                              <ChatMessage
                                role={role}
                                content={content}
                                userImageUrl={userImageUrl}
                                userName={userName}
                                createdAt={createdAt}
                                coworkerName={coworkerName}
                                coworkerId={selectedChat?.coworker?.id}
                                modelName={modelName}
                                modelId={modelId}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {isLoading &&
                        (() => {
                          // Check if the last message is an assistant message being streamed
                          // If it is, we're already rendering it, so hide the loading indicator
                          const lastMessage =
                            messagesWithTimestamps[
                              messagesWithTimestamps.length - 1
                            ];

                          if (lastMessage && lastMessage.role === "assistant") {
                            // The last message is an assistant message, so it's being streamed
                            // Hide the loading indicator
                            return null;
                          }

                          return (
                            <div className="flex gap-3 px-4 py-0">
                              <Avatar className="size-8 shrink-0">
                                {(() => {
                                  const selectedChat = chats.find(
                                    (c) => c.id === selectedChatId,
                                  );
                                  const coworkerId = selectedChat?.coworker?.id;
                                  const imageMap: Record<string, string> = {
                                    hannah: "/images/coworkers/hannah.png",
                                    demosthenes:
                                      "/images/coworkers/demosthenes.png",
                                  };
                                  const imageUrl = coworkerId
                                    ? imageMap[coworkerId]
                                    : null;
                                  return imageUrl ? (
                                    <AvatarImage
                                      src={imageUrl}
                                      alt={
                                        selectedChat?.coworker?.name ||
                                        "Coworker"
                                      }
                                      onError={(e) => {
                                        e.currentTarget.style.display = "none";
                                      }}
                                    />
                                  ) : null;
                                })()}
                                <AvatarFallback className="bg-primary text-primary-foreground">
                                  {(() => {
                                    const selectedChat = chats.find(
                                      (c) => c.id === selectedChatId,
                                    );
                                    return selectedChat?.coworker?.name
                                      ? selectedChat.coworker.name
                                          .charAt(0)
                                          .toUpperCase()
                                      : "A";
                                  })()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex items-center">
                                <div className="flex gap-1">
                                  <div className="bg-muted h-2 w-2 animate-pulse rounded-full" />
                                  <div className="bg-muted h-2 w-2 animate-pulse rounded-full delay-75" />
                                  <div className="bg-muted h-2 w-2 animate-pulse rounded-full delay-150" />
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                </ScrollArea>
              </div>
            )}
            <div className="bg-background/80 absolute right-0 bottom-0 left-0 z-10 flex shrink-0 justify-center px-4 py-2 backdrop-blur-sm">
              <div className="w-full max-w-[33.6rem]">
                <MultimodalInput
                  chatId={selectedChatId || undefined}
                  input={input}
                  setInput={setInput}
                  status={status}
                  stop={handleStop}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  messages={messages}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                  onSendMessage={handleSendMessage}
                  showSuggestedActions={false}
                  onSelectModel={handleModelSelected}
                  selectedModel={selectedModel}
                />
              </div>
            </div>
          </>
        ) : (
          // Show welcome screen when no chat is selected
          !selectedChatId && (
            <WelcomeScreen
              userName={userName?.split(" ")[0] ?? userName}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              isTransitioning={isWelcomeTransitioning}
              input={input}
              setInput={setInput}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              sendMessage={sendMessage}
              status={status}
              stop={handleStop}
            />
          )
        )}
      </div>
      <SelectCoworkerModal
        open={showSelectCoworkerModal}
        onOpenChange={setShowSelectCoworkerModal}
        onSelect={handleCoworkerSelected}
      />
    </div>
  );
}
