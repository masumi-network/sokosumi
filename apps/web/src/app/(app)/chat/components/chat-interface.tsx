"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useChatCreation } from "@/app/chat/hooks/use-chat-creation";
import { useChatMessages } from "@/app/chat/hooks/use-chat-messages";
import { useChatPreview } from "@/app/chat/hooks/use-chat-preview";
import { useChatScroll } from "@/app/chat/hooks/use-chat-scroll";
import { useChatSelection } from "@/app/chat/hooks/use-chat-selection";
import { useChatSync } from "@/app/chat/hooks/use-chat-sync";
import { useConversations } from "@/app/chat/hooks/use-conversations";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import type { Attachment } from "@/components/chat/preview-attachment";
import { addConversationItem } from "@/lib/actions/conversation/core-api-actions";

import ChatInputContainer from "./chat-input-container";
import MessageList from "./message-list";
import SelectCoworkerModal from "./select-coworker-modal";
import WelcomeScreen from "./welcome-screen";

interface ChatInterfaceProps {
  userImageUrl: string;
  userName?: string;
}

export default function ChatInterface({
  userImageUrl,
  userName,
}: ChatInterfaceProps) {
  const t = useTranslations("App.Chat.Chat");
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
  const [input, setInput] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSelectCoworkerModal, setShowSelectCoworkerModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    urlConversationId || null,
  );

  // Shared refs
  const selectedModelRef = useRef<{ id: string; name: string } | null>(null);
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const messagesChatIdRef = useRef<string | null>(null);
  const previousChatIdRef = useRef<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const isUpdatingUrlRef = useRef(false);
  const updateChatPreviewRef = useRef<
    ((chatId: string, content: string, isFirstMessage?: boolean) => void) | null
  >(null);

  // Update selectedModelRef when selectedModel changes
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  // useChat hook - needs to be called early for setMessages
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        // Use ref for synchronous access to current chat ID
        // Note: Accessing refs.current in this callback is safe - it's called during request, not render
        // eslint-disable-next-line react-compiler/react-compiler -- refs are accessed in callback, not render
        const chatId = currentChatIdRef.current || selectedChatId;
        // eslint-disable-next-line react-compiler/react-compiler -- refs are accessed in callback, not render
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
    onError: (error: unknown) => {
      console.error("Chat API error:", error);
    },
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
          // Always save assistant message to database via Core API
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

          // CRITICAL: Only update preview if messages belong to the currently selected chat
          // This prevents updating the wrong chat's preview when switching between chats
          // But we still save to DB regardless of these checks
          if (
            previousChatIdRef.current === selectedChatId &&
            messagesChatIdRef.current === selectedChatId
          ) {
            const isFirstAssistantMessage =
              finishedMessages.filter((m) => m.role === "assistant").length ===
              1;
            // Call updateChatPreview via ref
            if (updateChatPreviewRef.current) {
              updateChatPreviewRef.current(
                selectedChatId,
                content,
                isFirstAssistantMessage,
              );
            }
          }
        }
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Chat selection hook - needs setMessages from useChat
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
    setMessages,
    setInput,
    currentChatIdRef,
    previousChatIdRef,
    isUpdatingUrlRef,
  });

  // Chat preview hook
  const { updateChatPreview } = useChatPreview({
    conversations,
    chats,
    setChats,
    selectedChatId,
    messages,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
  });

  // Store updateChatPreview in ref for use in onFinish callback
  useEffect(() => {
    updateChatPreviewRef.current = updateChatPreview;
  }, [updateChatPreview]);

  // Chat messages hook - needs updateChatPreview
  const { cacheMessages, clearMessages } = useChatMessages({
    selectedChatId,
    selectedConversation,
    setMessages,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
    updateChatPreview,
  });

  // Chat creation hook
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
    setMessages,
    setInput,
    currentChatIdRef,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
    selectedModelRef,
    setSelectedModel,
    isUpdatingUrlRef,
    chats,
    conversations,
  });

  // Chat sync hook
  useChatSync({
    conversations,
    chats,
    setChats,
    selectedChatId,
    setSelectedModel,
    selectedModelRef,
  });

  // Update cache whenever messages change for the current chat
  useEffect(() => {
    if (
      selectedChatId &&
      previousChatIdRef.current === selectedChatId &&
      messagesChatIdRef.current === selectedChatId &&
      messages.length > 0
    ) {
      cacheMessages(selectedChatId, messages);
    }
  }, [
    messages,
    selectedChatId,
    cacheMessages,
    previousChatIdRef,
    messagesChatIdRef,
  ]);

  // Chat scroll hook
  const { scrollAreaRef, scrollToBottom } = useChatScroll({
    messages,
    isLoading,
    selectedChatId,
  });

  // Reserved for future use or parent component integration
  const _handleCreateNewChat = useCallback(() => {
    setShowSelectCoworkerModal(true);
  }, []);

  const handleModelSelected = useCallback(
    async (model: { id: string; name: string } | null) => {
      if (!model) {
        setSelectedModel(null);
        selectedModelRef.current = null;
        return;
      }
      await createModelChat(model);
    },
    [createModelChat, setSelectedModel],
  );

  const handleCoworkerSelected = useCallback(
    async (coworker: Coworker) => {
      await createCoworkerChat(coworker);
    },
    [createCoworkerChat],
  );

  // Reserved for future use or parent component integration
  const _handleDeleteChat = async (chatId: string) => {
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
    clearMessages(chatId);
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
                  status: "active",
                }
              : chat,
          ),
        );
      }

      // Scroll to bottom before sending message to make room for response
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
      sendMessage,
      setInput,
      handleCoworkerSelected,
      handleModelSelected,
      selectedModel,
      t,
      scrollToBottom,
      setIsWelcomeTransitioning,
      currentChatIdRef,
      setChats,
    ],
  );

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
              <MessageList
                messages={messages}
                selectedChatId={selectedChatId}
                chats={chats}
                userImageUrl={userImageUrl}
                userName={userName}
                isLoading={isLoading}
                scrollAreaRef={scrollAreaRef}
              />
            )}
            <ChatInputContainer
              selectedChatId={selectedChatId}
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
              selectedModel={selectedModel}
              onSelectModel={handleModelSelected}
              selectedChatCoworker={selectedChatCoworker}
            />
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
