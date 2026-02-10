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
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { useConversationsContext } from "@/contexts/conversations-context";
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
    deleteConversationById: _deleteConversationById,
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

  const selectedModelRef = useRef<{ id: string; name: string } | null>(null);
  const chatMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const messagesChatIdRef = useRef<string | null>(null);
  const previousChatIdRef = useRef<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  /** Conversation ID the current stream belongs to; set when request is prepared so onFinish persists to the correct conversation. */
  const streamingConversationIdRef = useRef<string | null>(null);
  const isUpdatingUrlRef = useRef(false);
  const updateChatPreviewRef = useRef<
    ((chatId: string, content: string, isFirstMessage?: boolean) => void) | null
  >(null);
  /** Synced in effect so prepareSendMessagesRequest does not read refs during render */
  const sendParamsRef = useRef<{
    chatId: string | null;
    model: { id: string; name: string } | null;
  }>({ chatId: null, model: null });

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    sendParamsRef.current = {
      chatId: currentChatIdRef.current || selectedChatId,
      model: selectedModelRef.current,
    };
  }, [selectedChatId, selectedModel]);

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    // prepareSendMessagesRequest runs on send, not during render; refs are read only then
    /* eslint-disable react-hooks/refs */
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        const { chatId, model } = sendParamsRef.current;
        streamingConversationIdRef.current = chatId;
        const body = {
          messages: request.messages,
          ...(chatId ? { conversationId: chatId } : {}),
          ...(model ? { model: model.id } : {}),
          ...request.body,
        };
        return { body };
      },
    }),
    /* eslint-enable react-hooks/refs */
    onError: (error: unknown) => {
      console.error("Chat API error:", error);
    },
    onFinish: ({ messages: finishedMessages }) => {
      const conversationId = streamingConversationIdRef.current;
      if (!conversationId || finishedMessages.length === 0) {
        return;
      }

      // Find the last assistant message
      const lastAssistantMessage = [...finishedMessages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      if (lastAssistantMessage) {
        const content = extractMessageContent(lastAssistantMessage);
        if (content) {
          const formattedContent: Array<{ type: string; text: string }> =
            content ? [{ type: "output_text", text: content }] : [];

          addConversationItem({
            conversationId,
            role: "assistant",
            content: formattedContent,
          }).catch((error) => {
            console.error(
              "Failed to add assistant message to conversation:",
              error,
            );
          });

          if (
            previousChatIdRef.current === conversationId &&
            messagesChatIdRef.current === conversationId
          ) {
            const isFirstAssistantMessage =
              finishedMessages.filter((m) => m.role === "assistant").length ===
              1;
            if (updateChatPreviewRef.current) {
              updateChatPreviewRef.current(
                conversationId,
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

  useChatSelection({
    urlConversationId,
    pathname,
    conversations,
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
    stopStreaming: stop,
  });

  const { updateChatPreview } = useChatPreview({ setChats });

  useEffect(() => {
    updateChatPreviewRef.current = updateChatPreview;
  }, [updateChatPreview]);

  const { cacheMessages, clearMessages: _clearMessages } = useChatMessages({
    selectedChatId,
    selectedConversation,
    setMessages,
    previousChatIdRef,
    messagesChatIdRef,
    chatMessagesRef,
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

  const { scrollAreaRef, scrollToBottom } = useChatScroll({
    messages,
    isLoading,
    selectedChatId,
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
          // Use provided coworker or default to Hannah
          const selectedCoworker: Coworker = coworker || {
            id: "hannah",
            name: t("coworkers.hannah.name"),
            description: t("coworkers.hannah.description"),
            useCase: t("coworkers.hannah.useCase"),
          };
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

        scrollToBottom();
        requestAnimationFrame(() => {
          scrollToBottom();
        });

        sendMessage({ text: trimmedMessage });
        setInput("");
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

  // Get the selected chat's coworker for MultimodalInput
  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const selectedChatCoworker = selectedChat?.coworker;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg">
      <div className="relative flex h-full min-h-0 w-full flex-col">
        {selectedChatId ? (
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
          <WelcomeScreen
            userName={userName?.split(" ")[0] ?? userName}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            isTransitioning={isWelcomeTransitioning}
            input={input}
            setInput={setInput}
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            status={status}
            stop={handleStop}
          />
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
