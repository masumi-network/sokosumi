"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Conversation } from "@/lib/actions/conversation";

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
    deleteSelectedConversation,
  } = useConversations();

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Store messages per chat ID (in-memory cache)
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const previousChatIdRef = useRef<string | null>(null);

  // Helper to get localStorage key for a conversation
  const getMessagesStorageKey = useCallback((conversationId: string) => {
    return `coworker-chat-messages-${conversationId}`;
  }, []);

  // Helper to load messages from localStorage
  const loadMessagesFromStorage = useCallback(
    (conversationId: string): unknown[] | null => {
      try {
        const storageKey = getMessagesStorageKey(conversationId);
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Convert dates back from ISO strings and ensure UIMessage format
          return parsed.map((msg: Record<string, unknown>) => {
            const contentText =
              typeof msg.content === "string"
                ? msg.content
                : msg.parts && Array.isArray(msg.parts)
                  ? msg.parts
                      .map((p: unknown) =>
                        p && typeof p === "object" && "text" in p
                          ? String(p.text)
                          : "",
                      )
                      .join("")
                  : "";
            return {
              ...msg,
              id: msg.id || `msg-${Date.now()}-${Math.random()}`,
              role: msg.role || "user",
              parts: msg.parts || [{ type: "text", text: contentText }],
              content: contentText || msg.content || "",
              createdAt: msg.createdAt
                ? new Date(msg.createdAt as string)
                : new Date(),
            };
          });
        }
      } catch (error) {
        console.error("Failed to load messages from localStorage:", error);
      }
      return null;
    },
    [getMessagesStorageKey],
  );

  // Helper to save messages to localStorage
  const saveMessagesToStorage = useCallback(
    (conversationId: string, messagesToSave: unknown[]) => {
      try {
        const storageKey = getMessagesStorageKey(conversationId);
        // Convert to JSON-safe format (dates become ISO strings)
        const serializable = messagesToSave.map((msg: unknown) => {
          const msgObj = msg as Record<string, unknown>;
          return {
            ...msgObj,
            createdAt:
              msgObj.createdAt instanceof Date
                ? msgObj.createdAt.toISOString()
                : typeof msgObj.createdAt === "string"
                  ? msgObj.createdAt
                  : new Date().toISOString(),
          };
        });
        localStorage.setItem(storageKey, JSON.stringify(serializable));
      } catch (error) {
        console.error("Failed to save messages to localStorage:", error);
      }
    },
    [getMessagesStorageKey],
  );

  // Function to update chat preview with assistant message
  const updateChatPreview = useCallback(
    (chatId: string, content: string, isFirstMessage = false) => {
      if (!content || !content.trim()) {
        return;
      }

      const now = new Date();
      setChats((prev) =>
        prev.map((chat) => {
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
        }),
      );
    },
    [selectedChatId, t],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/coworkers/chat",
      body: selectedChatId
        ? {
            conversationId: selectedChatId,
          }
        : undefined,
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

  // Preload messages from localStorage for all conversations when they're loaded
  useEffect(() => {
    if (conversations.length === 0) {
      return;
    }

    // Preload messages from localStorage for each conversation
    conversations.forEach((conv) => {
      // Skip if already loaded in memory
      if (chatMessagesRef.current.has(conv.id)) {
        return;
      }

      // Try to load from localStorage
      const storedMessages = loadMessagesFromStorage(conv.id);
      if (storedMessages && storedMessages.length > 0) {
        // Store in memory for faster access
        chatMessagesRef.current.set(conv.id, storedMessages);

        // Extract last assistant message for preview
        const lastAssistantMessage = [...storedMessages]
          .reverse()
          .find((msg: unknown) => {
            const msgAny = msg as Record<string, unknown>;
            return msgAny.role === "assistant";
          });

        if (lastAssistantMessage) {
          const content = extractMessageContent(lastAssistantMessage);
          const createdAt = (lastAssistantMessage as Record<string, unknown>)
            .createdAt;
          const messageTime =
            createdAt instanceof Date
              ? createdAt
              : typeof createdAt === "string"
                ? new Date(createdAt)
                : new Date();

          if (content) {
            // Update chat preview with last message
            setChats((prev) =>
              prev.map((chat) =>
                chat.id === conv.id
                  ? {
                      ...chat,
                      lastMessage: content,
                      lastMessageTime: messageTime,
                    }
                  : chat,
              ),
            );
          }
        }
      }
    });
  }, [conversations, loadMessagesFromStorage]);

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

        // Try to get lastMessage from localStorage if not in existingChat
        let lastMessage = existingChat?.lastMessage;
        let lastMessageTime = existingChat?.lastMessageTime;

        if (!lastMessage) {
          // Try to load from localStorage to get last message
          const storedMessages = chatMessagesRef.current.get(conv.id);
          if (storedMessages && storedMessages.length > 0) {
            const lastAssistantMessage = [...storedMessages]
              .reverse()
              .find((msg: unknown) => {
                const msgAny = msg as Record<string, unknown>;
                return msgAny.role === "assistant";
              });

            if (lastAssistantMessage) {
              const content = extractMessageContent(lastAssistantMessage);
              const createdAt = (
                lastAssistantMessage as Record<string, unknown>
              ).createdAt;
              if (content) {
                lastMessage = content;
                lastMessageTime =
                  createdAt instanceof Date
                    ? createdAt
                    : typeof createdAt === "string"
                      ? new Date(createdAt)
                      : new Date();
              }
            }
          }
        }

        return {
          id: conv.id,
          title: conv.title || coworkerName || t("newChat"),
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
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

  const handleCreateNewChat = () => {
    setShowSelectCoworkerModal(true);
  };

  const handleCoworkerSelected = async (coworker: Coworker) => {
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
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
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
  };

  // Track which chat ID the current messages belong to
  const messagesChatIdRef = useRef<string | null>(null);

  // Load messages when switching chats
  useEffect(() => {
    // CRITICAL: Clear messages IMMEDIATELY when switching chats to prevent race conditions
    // This ensures old messages don't get associated with the new chat
    if (selectedChatId) {
      const currentSelectedChatId = selectedChatId;

      // Clear messages immediately and mark as belonging to no chat
      messagesChatIdRef.current = null;
      setMessages([]);

      // Set ref AFTER clearing messages to prevent preview updates with wrong messages
      previousChatIdRef.current = currentSelectedChatId;

      // Use setTimeout to ensure messages are cleared before loading new ones
      // This prevents race conditions when switching chats quickly
      const timeoutId = setTimeout(() => {
        // Only proceed if we're still on the same chat (user didn't switch again)
        if (selectedChatId !== currentSelectedChatId) {
          return;
        }

        // 1. First try to load from memory (for current session)
        const savedMessages = chatMessagesRef.current.get(
          currentSelectedChatId,
        );
        if (savedMessages && savedMessages.length > 0) {
          messagesChatIdRef.current = currentSelectedChatId;
          setMessages(savedMessages as Parameters<typeof setMessages>[0]);
          return;
        }

        // 2. Try to load from localStorage (persisted across sessions)
        const storedMessages = loadMessagesFromStorage(currentSelectedChatId);
        if (storedMessages && storedMessages.length > 0) {
          messagesChatIdRef.current = currentSelectedChatId;
          setMessages(storedMessages as Parameters<typeof setMessages>[0]);
          // Also save to memory for faster access
          chatMessagesRef.current.set(currentSelectedChatId, storedMessages);
          return;
        }

        // 3. Try to load from selectedConversation.items (from DB, if available)
        if (
          selectedConversation?.id === currentSelectedChatId &&
          selectedConversation.items &&
          selectedConversation.items.length > 0
        ) {
          // Convert ConversationItem[] to UIMessage format
          // UIMessage format requires 'parts' array with text content
          const dbMessages = selectedConversation.items.map((item) => {
            const contentText =
              typeof item.content === "string"
                ? item.content
                : item.content.map((c) => c.text || "").join("");
            return {
              id: item.id,
              role: item.role,
              parts: [{ type: "text", text: contentText }],
              content: contentText,
              createdAt: new Date(item.created_at),
            };
          });
          messagesChatIdRef.current = currentSelectedChatId;
          setMessages(
            dbMessages as unknown as Parameters<typeof setMessages>[0],
          );
          // Save to both memory and localStorage
          chatMessagesRef.current.set(currentSelectedChatId, dbMessages);
          saveMessagesToStorage(currentSelectedChatId, dbMessages);
          return;
        }

        // 4. No messages found - start fresh
        messagesChatIdRef.current = currentSelectedChatId;
        setMessages([]);
      }, 0);

      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      previousChatIdRef.current = null;
      messagesChatIdRef.current = null;
      setMessages([]);
    }
  }, [
    selectedChatId,
    selectedConversation,
    setMessages,
    loadMessagesFromStorage,
    saveMessagesToStorage,
  ]);

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
      const dbMessages = selectedConversation.items.map((item) => {
        const contentText =
          typeof item.content === "string"
            ? item.content
            : item.content.map((c) => c.text || "").join("");
        return {
          id: item.id,
          role: item.role,
          parts: [{ type: "text", text: contentText }],
          content: contentText,
          createdAt: new Date(item.created_at),
        };
      });
      messagesChatIdRef.current = selectedChatId; // Track that messages belong to this chat
      setMessages(dbMessages as unknown as Parameters<typeof setMessages>[0]);
      // Save to both memory and localStorage
      chatMessagesRef.current.set(selectedChatId, dbMessages);
      saveMessagesToStorage(selectedChatId, dbMessages);
      previousChatIdRef.current = selectedChatId;
    }
  }, [
    selectedConversation,
    selectedChatId,
    setMessages,
    saveMessagesToStorage,
  ]);

  // Save messages whenever they change for the current chat (but not during initial load)
  useEffect(() => {
    if (
      selectedChatId &&
      previousChatIdRef.current === selectedChatId &&
      messagesChatIdRef.current === selectedChatId &&
      messages.length > 0
    ) {
      // Save to memory
      chatMessagesRef.current.set(selectedChatId, messages);
      // Also persist to localStorage
      saveMessagesToStorage(selectedChatId, messages);
    }
  }, [messages, selectedChatId, saveMessagesToStorage]);

  const handleSelectChat = async (chatId: string | null) => {
    if (!chatId) {
      setSelectedChatId(null);
      return;
    }

    // Load conversation from DB
    await selectConversation(chatId);

    setSelectedChatId(chatId);
    // Clear unread count when selecting a chat
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, unreadCount: undefined } : chat,
      ),
    );
  };

  const handleDeleteChat = async (chatId: string) => {
    // Delete from DB if this is the selected conversation
    if (selectedChatId === chatId) {
      await deleteSelectedConversation();
      setSelectedChatId(null);
      setMessages([]);
      setInput("");
    }

    // Remove from local state
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    chatMessagesRef.current.delete(chatId);
    // Also remove from localStorage
    try {
      const storageKey = getMessagesStorageKey(chatId);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error("Failed to remove messages from localStorage:", error);
    }
  };

  const handleInputSubmit = () => {
    if (!input.trim() || isLoading) return;

    const messageText = input.trim();
    if (!selectedChatId) {
      handleCreateNewChat();
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

    sendMessage({ text: messageText });
    setInput("");
  };

  const handleStop = () => {
    // Stop the current streaming response
    // The useChat hook doesn't have a direct stop method in v6,
    // but we can clear the input and reset state if needed
    // For now, this is a placeholder for future stop functionality
  };

  return (
    <div className="flex h-[calc(100vh-200px)] w-full overflow-hidden rounded-lg border">
      <div className="w-64 shrink-0">
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
          onCreateNewChat={handleCreateNewChat}
          onDeleteChat={handleDeleteChat}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {selectedChatId && (
          <div className="bg-card shrink-0 border-b px-6 py-4">
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
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
            {(() => {
              const selectedChat = chats.find((c) => c.id === selectedChatId);
              const coworker = selectedChat?.coworker;
              return (
                <>
                  <MessageSquare className="text-muted-foreground mb-4 size-12" />
                  <h2 className="mb-2 text-xl font-semibold">
                    {t("emptyState.title")}
                  </h2>
                  <p className="text-muted-foreground mb-4 max-w-md text-sm">
                    {t("emptyState.description")}
                  </p>
                  {coworker?.useCase && (
                    <div className="bg-muted/50 mt-4 max-w-md rounded-lg border p-4">
                      <p className="mb-2 text-sm font-medium">
                        {t("emptyState.suggestionTitle")}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {coworker.useCase}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
            <div className="flex flex-col pt-4">
              {messagesWithTimestamps.map((message) => {
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
                    const contentObj = msgContent as Record<string, unknown>;
                    if ("text" in contentObj) {
                      content = String(contentObj.text);
                    } else {
                      content = JSON.stringify(contentObj);
                    }
                  } else if (msgContent !== null && msgContent !== undefined) {
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
                const selectedChat = chats.find((c) => c.id === selectedChatId);
                const coworkerName = selectedChat?.coworker?.name;

                return (
                  <ChatMessage
                    key={message.id}
                    role={role}
                    content={content}
                    userImageUrl={userImageUrl}
                    userName={userName}
                    createdAt={createdAt}
                    coworkerName={coworkerName}
                  />
                );
              })}
              {isLoading &&
                (() => {
                  // Check if the last message is an assistant message being streamed
                  // If it is, we're already rendering it, so hide the loading indicator
                  const lastMessage =
                    messagesWithTimestamps[messagesWithTimestamps.length - 1];

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
                              ? selectedChat.coworker.name.charAt(0).toUpperCase()
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
        <div className="w-full max-w-full shrink-0 overflow-hidden border-t">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleInputSubmit}
            onStop={handleStop}
            isLoading={isLoading}
          />
        </div>
      </div>
      <SelectCoworkerModal
        open={showSelectCoworkerModal}
        onOpenChange={setShowSelectCoworkerModal}
        onSelect={handleCoworkerSelected}
      />
    </div>
  );
}
