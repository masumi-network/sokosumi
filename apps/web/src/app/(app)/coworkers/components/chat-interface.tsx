"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  if ("content" in messageAny && messageAny.content !== undefined && messageAny.content !== null) {
    const msgContent = messageAny.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const partObj = part as Record<string, unknown>;
            if ("text" in partObj && partObj.text !== null && partObj.text !== undefined) {
              return String(partObj.text);
            }
            if ("content" in partObj && partObj.content !== null && partObj.content !== undefined) {
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
          if ("text" in partObj && partObj.text !== null && partObj.text !== undefined) {
            return String(partObj.text);
          }
          if ("content" in partObj && partObj.content !== null && partObj.content !== undefined) {
            return String(partObj.content);
          }
          // Try direct stringification if it's a simple object
          if ("type" in partObj && partObj.type === "text" && "text" in partObj) {
            return String(partObj.text);
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  // Fallback: try "text" property directly
  if (!content && "text" in messageAny && messageAny.text !== undefined && messageAny.text !== null) {
    content = String(messageAny.text);
  }

  return content.trim();
}

export default function ChatInterface({
  userImageUrl,
  userName,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Coworkers.Chat");
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Store messages per chat ID
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const previousChatIdRef = useRef<string | null>(null);

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
              ...(isFirstMessage && { title: content.slice(0, 50) || t("newChat") }),
              lastMessage: content,
              lastMessageTime: now,
              updatedAt: now,
              status: "active" as ChatStatus,
              unreadCount: chatId === selectedChatId ? undefined : chat.unreadCount,
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
    }),
    onFinish: ({ messages: finishedMessages }) => {
      if (!selectedChatId || finishedMessages.length === 0) {
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
      console.log("[useEffect] Early return", { selectedChatId, messagesCount: messages.length });
      return;
    }

    // Find the last assistant message
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === "assistant");

    console.log("[useEffect] Checking messages", {
      messagesCount: messages.length,
      hasAssistantMessage: !!lastAssistantMessage,
      lastAssistantMessage: lastAssistantMessage ? {
        role: lastAssistantMessage.role,
        id: lastAssistantMessage.id,
        hasContent: "content" in (lastAssistantMessage as unknown as Record<string, unknown>),
      } : null,
    });

    if (lastAssistantMessage) {
      const content = extractMessageContent(lastAssistantMessage);
      console.log("[useEffect] Extracted content", {
        content: content.substring(0, 100),
        length: content.length,
      });
      if (content) {
        // Check if this content is different from what's currently stored
        const currentChat = chats.find((c) => c.id === selectedChatId);
        console.log("[useEffect] Current chat state", {
          found: !!currentChat,
          currentLastMessage: currentChat?.lastMessage?.substring(0, 50),
          newContent: content.substring(0, 50),
          isDifferent: !currentChat || currentChat.lastMessage !== content,
        });
        if (!currentChat || currentChat.lastMessage !== content) {
          const isFirstAssistantMessage =
            messages.filter((m) => m.role === "assistant").length === 1;
          // Use requestAnimationFrame to batch the state update
          requestAnimationFrame(() => {
            updateChatPreview(selectedChatId, content, isFirstAssistantMessage);
          });
        }
      } else {
        console.log("[useEffect] No content extracted");
      }
    } else {
      console.log("[useEffect] No assistant message found");
    }
  }, [messages, selectedChatId, chats, updateChatPreview]);

  const handleCreateNewChat = () => {
    setShowSelectCoworkerModal(true);
  };

  const handleCoworkerSelected = (coworker: Coworker) => {
    const now = new Date();
    const newChatId = `chat-${Date.now()}`;
    const newChat: Chat = {
      id: newChatId,
      title: coworker.name,
      createdAt: now,
      updatedAt: now,
      status: "active",
      coworker,
    };
    // Initialize empty messages for new chat
    chatMessagesRef.current.set(newChatId, []);
    setMessages([]);
    setInput("");
    setChats((prev) => [newChat, ...prev]);
    setSelectedChatId(newChatId);
  };

  // Load messages when switching chats
  useEffect(() => {
    if (selectedChatId) {
      const savedMessages = chatMessagesRef.current.get(selectedChatId);
      if (savedMessages && savedMessages.length > 0) {
        setMessages(savedMessages as Parameters<typeof setMessages>[0]);
      } else {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
    // Update ref after loading
    previousChatIdRef.current = selectedChatId;
  }, [selectedChatId, setMessages]);

  // Save messages whenever they change for the current chat (but not during initial load)
  useEffect(() => {
    if (selectedChatId && previousChatIdRef.current === selectedChatId) {
      chatMessagesRef.current.set(selectedChatId, messages);
    }
  }, [messages, selectedChatId]);

  const handleSelectChat = (chatId: string | null) => {
    setSelectedChatId(chatId);
    // Clear unread count when selecting a chat
    if (chatId) {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, unreadCount: undefined } : chat,
        ),
      );
    }
  };

  const handleDeleteChat = (chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setMessages([]);
      setInput("");
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
      <div className="flex flex-1 flex-col min-h-0">
        {selectedChatId && (
          <div className="border-b bg-card px-6 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(() => {
                  const selectedChat = chats.find((c) => c.id === selectedChatId);
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
                {selectedChatId && (() => {
                  const selectedChat = chats.find((c) => c.id === selectedChatId);
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
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center min-h-0">
            <MessageSquare className="text-muted-foreground mb-4 size-12" />
            <h2 className="mb-2 text-xl font-semibold">{t("emptyTitle")}</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {t("emptyDescription")}
            </p>
          </div>
        ) : (
          <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
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
                if (!content && role === "user" && typeof message === "string") {
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
              {isLoading && (() => {
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
                  <div className="flex gap-4 px-4 py-6">
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        A
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                      <div className="text-sm font-medium">{t("assistant")}</div>
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
        <div className="shrink-0 border-t w-full max-w-full overflow-hidden">
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
