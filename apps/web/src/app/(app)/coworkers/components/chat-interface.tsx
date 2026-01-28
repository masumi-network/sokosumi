"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { Conversation } from "@/lib/actions/conversation";
import {
  addConversationItem,
  getConversationItems,
} from "@/lib/actions/conversation/core-api-actions";
import { cn } from "@/lib/utils";

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { useConversations } from "../hooks/use-conversations";
import ChatInput from "./chat-input";
import ChatMessage from "./chat-message";
import ChatSidebar, { type ChatStatus, type Coworker } from "./chat-sidebar";
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
  unreadCount?: number;
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
}: {
  userName?: string;
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  isTransitioning: boolean;
}) {
  const t = useTranslations("App.Coworkers.Chat");
  const [welcomeInput, setWelcomeInput] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (welcomeInput.trim() && !isLoading) {
      onSendMessage(welcomeInput.trim());
      setWelcomeInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing) {
        return;
      }
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();
      const form = e.currentTarget.form;
      form?.requestSubmit();
    }
  };

  const isStreaming = isLoading;
  const canSubmit = !isLoading && welcomeInput.trim();

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center p-8 transition-opacity duration-500",
        isTransitioning && "animate-out fade-out duration-500",
      )}
    >
      <div
        className={cn(
          "mb-8 text-center transition-all duration-500",
          isTransitioning &&
            "animate-out fade-out slide-out-to-top-4 duration-500",
        )}
      >
        <h1 className="mb-4 text-3xl font-semibold">
          {userName
            ? t("welcomeScreen.titleWithName", { name: userName })
            : t("welcomeScreen.title")}
        </h1>
      </div>
      <form
        onSubmit={handleSubmit}
        className={cn(
          "bg-background w-full max-w-2xl overflow-hidden rounded-xl border shadow-sm transition-all duration-500",
          isTransitioning &&
            "animate-out fade-out slide-out-to-bottom-4 duration-500",
        )}
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 overflow-hidden">
            <Textarea
              value={welcomeInput}
              onChange={(e) => setWelcomeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("welcomeScreen.placeholder")}
              disabled={isLoading}
              name="message"
              className={cn(
                "w-full resize-none rounded-none border-none px-3 py-1.5 shadow-none ring-0 outline-hidden",
                "field-sizing-content max-h-[6lh] min-h-lh",
                "bg-transparent dark:bg-transparent",
                "focus-visible:ring-0",
                "overflow-x-hidden overflow-y-auto wrap-break-word break-all whitespace-pre-wrap",
                "[&::-webkit-scrollbar-thumb]:bg-muted [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                "[scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:rgb(161_161_170)_transparent] focus:[scrollbar-color:rgb(161_161_170)_transparent]",
              )}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                wordBreak: "break-word",
                lineHeight: "1.5",
              }}
            />
          </div>
          <div className="shrink-0 p-1">
            {isStreaming ? (
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-lg"
                type="button"
                disabled
              >
                <Loader2 className="size-4 animate-spin" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSubmit}
                variant="primary"
                size="icon"
                className="h-8 w-8 rounded-lg"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

// Empty chat state component with suggestion buttons and centered input
function EmptyChatState({
  selectedChatId,
  chats,
  isLoading,
  onSendMessage,
  input,
  onInputChange,
  onInputSubmit,
}: {
  selectedChatId: string;
  chats: Chat[];
  isLoading: boolean;
  onSendMessage: (message: string) => void;
  input: string;
  onInputChange: (value: string) => void;
  onInputSubmit: () => void;
}) {
  const t = useTranslations("App.Coworkers.Chat");
  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const coworker = selectedChat?.coworker;
  const suggestions = useMemo(
    () => getCoworkerSuggestions(coworker?.id),
    [coworker?.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="mb-8">
        <h2 className="mb-2 text-3xl font-semibold">
          {coworker
            ? t("emptyState.titleWithName", { name: coworker.name })
            : t("emptyState.title")}
        </h2>
        {suggestions.length > 0 && (
          <div className="mt-4 w-full max-w-2xl">
            <p className="mb-3 text-sm font-medium">
              {t("emptyState.suggestionTitle")}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => onSendMessage(suggestion)}
                  disabled={isLoading}
                  className="bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg border px-4 py-2 text-sm transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {coworker?.useCase && suggestions.length === 0 && (
          <div className="bg-muted/50 mt-4 max-w-md rounded-lg border p-4">
            <p className="mb-2 text-sm font-medium">
              {t("emptyState.suggestionTitle")}
            </p>
            <p className="text-muted-foreground text-sm">{coworker.useCase}</p>
          </div>
        )}
      </div>
      <div className="w-full max-w-2xl">
        <ChatInput
          value={input}
          onChange={onInputChange}
          onSubmit={onInputSubmit}
          isLoading={isLoading}
          disabled={false}
        />
      </div>
    </div>
  );
}

export default function ChatInterface({
  userImageUrl,
  userName,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Coworkers.Chat");
  const {
    conversations,
    selectedConversation,
    createNewConversation,
    selectConversation,
    deleteConversationById,
  } = useConversations();

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false);
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
              unreadCount:
                chatId === selectedChatId ? undefined : chat.unreadCount,
            };
          }
          // Increment unread count for other chats
          if (chatId !== selectedChatId) {
            return {
              ...chat,
              unreadCount: (chat.unreadCount ?? 0) + 1,
            };
          }
          return chat;
        });
      });
    },
    [selectedChatId, t],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/coworkers/chat",
      prepareSendMessagesRequest(request) {
        // Use ref for synchronous access to current chat ID
        const chatId = currentChatIdRef.current || selectedChatId;
        const body = {
          messages: request.messages,
          ...(chatId ? { conversationId: chatId } : {}),
          ...request.body,
        };
        return { body };
      },
    }),
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
    if (messagesEndRef.current && scrollAreaRef.current) {
      requestAnimationFrame(() => {
        const scrollContainer = scrollAreaRef.current?.querySelector(
          '[data-slot="scroll-area-viewport"]',
        ) as HTMLElement | null;
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  }, [messages, isLoading]);

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

  // Auto-select first chat when conversations are loaded
  useEffect(() => {
    if (conversations.length > 0 && !selectedChatId && chats.length > 0) {
      // Select the first conversation
      const firstChatId = chats[0]?.id;
      if (firstChatId) {
        void handleSelectChat(firstChatId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, chats.length]); // Only depend on length to avoid re-running when conversations change

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

        // Find existing chat to preserve UI state (lastMessage, unreadCount, etc.)
        const existingChat = chats.find((c) => c.id === conv.id);

        // Build coworker object from metadata or existing chat
        let coworker: Coworker | undefined;
        if (existingChat?.coworker) {
          coworker = existingChat.coworker;
        } else if (coworkerId && coworkerName) {
          // For new conversations, we need to get full coworker info
          // For now, create a minimal coworker - the full info will be preserved from handleCoworkerSelected
          coworker = {
            id: coworkerId,
            name: coworkerName,
            description: "", // Will be filled from existing chat if available
            useCase: "", // Will be filled from existing chat if available
          };
        }

        // Get lastMessage from existing chat (preserved from previous state)
        // Note: Last message will be updated when messages are loaded from DB
        const lastMessage = existingChat?.lastMessage;
        const lastMessageTime = existingChat?.lastMessageTime;

        return {
          id: conv.id,
          title: conv.title || coworkerName || t("newChat"),
          createdAt: new Date(conv.createdAt),
          updatedAt: new Date(conv.updatedAt),
          status: (existingChat?.status || "active") as ChatStatus,
          coworker,
          lastMessage,
          lastMessageTime,
          unreadCount: existingChat?.unreadCount,
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

  const handleCoworkerSelected = useCallback(
    async (coworker: Coworker) => {
      // Create conversation and store in DB
      const conversation = await createNewConversation(
        {
          coworker_id: coworker.id,
          coworker_name: coworker.name,
          coworker_description: coworker.description,
          coworker_useCase: coworker.useCase,
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
    },
    [createNewConversation, setMessages, setInput, setChats, setSelectedChatId],
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
      return;
    }

    // Load conversation from DB
    await selectConversation(chatId);

    setSelectedChatId(chatId);
    // Update ref immediately for synchronous access in prepareSendMessagesRequest
    currentChatIdRef.current = chatId;
    // Clear unread count when selecting a chat
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, unreadCount: undefined } : chat,
      ),
    );
  };

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
    async (messageText: string) => {
      if (!messageText.trim() || isLoading) return;

      const trimmedMessage = messageText.trim();

      // If no chat exists, create one with Hannah as default
      if (!selectedChatId && chats.length === 0) {
        // Start transition animation
        setIsWelcomeTransitioning(true);

        const hannahCoworker: Coworker = {
          id: "hannah",
          name: t("coworkers.hannah.name"),
          description: t("coworkers.hannah.description"),
          useCase: t("coworkers.hannah.useCase"),
        };

        // Wait for welcome screen fade-out to complete before showing chat UI
        await new Promise((resolve) => setTimeout(resolve, 300));

        await handleCoworkerSelected(hannahCoworker);
        // Wait a bit for the conversation to be created and selected
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Now send the message
        sendMessage({ text: trimmedMessage });
        setInput("");
        return;
      }

      if (!selectedChatId) {
        handleCreateNewChat();
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
                  unreadCount: undefined,
                }
              : chat,
          ),
        );
      }

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
      t,
    ],
  );

  const handleInputSubmit = () => {
    handleSendMessage(input);
  };

  const handleStop = () => {
    // Stop the current streaming response
    // The useChat hook doesn't have a direct stop method in v6,
    // but we can clear the input and reset state if needed
    // For now, this is a placeholder for future stop functionality
  };

  // Show welcome screen when there are no chats
  if (
    chats.length === 0 &&
    conversations.length === 0 &&
    !isWelcomeTransitioning
  ) {
    // Extract first name from userName
    const firstName = userName?.split(" ")[0] ?? userName;
    return (
      <div className="flex h-[calc(100vh-200px)] w-full overflow-hidden rounded-lg border">
        <WelcomeScreen
          userName={firstName}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          isTransitioning={isWelcomeTransitioning}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-200px)] w-full overflow-hidden rounded-lg border">
      <div
        className={cn(
          "w-96 shrink-0 transition-opacity duration-700",
          chats.length > 0 && conversations.length > 0 && isWelcomeTransitioning
            ? "animate-in fade-in slide-in-from-left-4 delay-200 duration-500"
            : chats.length > 0 && conversations.length > 0
              ? "opacity-100"
              : "opacity-0",
        )}
      >
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
          onCreateNewChat={handleCreateNewChat}
          onDeleteChat={handleDeleteChat}
        />
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-opacity duration-700",
          chats.length > 0 && conversations.length > 0 && isWelcomeTransitioning
            ? "animate-in fade-in slide-in-from-right-4 delay-300 duration-500"
            : chats.length > 0 && conversations.length > 0
              ? "opacity-100"
              : "opacity-0",
        )}
      >
        {selectedChatId && messages.length > 0 && (
          <div className="bg-card animate-in fade-in slide-in-from-top-2 shrink-0 border-b px-6 py-4 duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(() => {
                  const selectedChat = chats.find(
                    (c) => c.id === selectedChatId,
                  );
                  if (selectedChat?.coworker) {
                    return (
                      <>
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {selectedChat.coworker.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <h2 className="text-lg font-semibold">
                          {selectedChat.coworker.name}
                        </h2>
                      </>
                    );
                  }
                  return (
                    <h2 className="text-lg font-semibold">
                      {selectedChat?.title || t("assistant")}
                    </h2>
                  );
                })()}
                {selectedChatId &&
                  (() => {
                    const selectedChat = chats.find(
                      (c) => c.id === selectedChatId,
                    );
                    if (selectedChat?.status === "awaiting") {
                      return (
                        <Badge
                          variant="default"
                          className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                        >
                          {t("statusAwaiting")}
                        </Badge>
                      );
                    }
                    return null;
                  })()}
              </div>
            </div>
          </div>
        )}
        {selectedChatId && messages.length === 0 ? (
          <EmptyChatState
            selectedChatId={selectedChatId}
            chats={chats}
            isLoading={status === "streaming" || status === "submitted"}
            onSendMessage={handleSendMessage}
            input={input}
            onInputChange={setInput}
            onInputSubmit={handleInputSubmit}
          />
        ) : (
          <>
            {showMessagesAfterTransition && (
              <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
                <div className="animate-in fade-in flex flex-col pt-4 duration-500">
                  {messagesWithTimestamps.map((message, index) => {
                    const role = message.role as "user" | "assistant";
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
                              const partObj = part as Record<string, unknown>;
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
                      } else if (msgContent && typeof msgContent === "object") {
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
                            if ("text" in partObj) return String(partObj.text);
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

                    return (
                      <div
                        key={message.id}
                        className="animate-in fade-in slide-in-from-bottom-2 duration-500"
                        style={{
                          animationDelay: `${index * 50}ms`,
                        }}
                      >
                        <ChatMessage
                          role={role}
                          content={content}
                          userImageUrl={userImageUrl}
                          userName={userName}
                          createdAt={createdAt}
                          coworkerName={coworkerName}
                        />
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
              </ScrollArea>
            )}
            <div className="animate-in fade-in slide-in-from-bottom-4 flex shrink-0 justify-center overflow-hidden p-4 duration-500">
              <div className="w-full max-w-2xl">
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={handleInputSubmit}
                  onStop={handleStop}
                  isLoading={isLoading}
                />
              </div>
            </div>
          </>
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
