"use client";

import type { UIMessage } from "ai";
import { useRef } from "react";

import {
  formatDaySeparator,
  isDifferentDay,
} from "@/app/chat/utils/date-utils";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { ScrollArea } from "@/components/ui/scroll-area";

import ChatMessage from "./chat-message";
import DaySeparator from "./day-separator";
import LoadingIndicator from "./loading-indicator";

interface MessageListProps {
  messages: UIMessage[];
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
  userImageUrl: string;
  userName?: string;
  isLoading: boolean;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
}

export default function MessageList({
  messages,
  selectedChatId,
  chats,
  coworkers = [],
  userImageUrl,
  userName,
  isLoading,
  scrollAreaRef,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Check if the last message is an assistant message being streamed
  const lastMessage = messagesWithTimestamps[messagesWithTimestamps.length - 1];
  const showLoadingIndicator =
    isLoading && (!lastMessage || lastMessage.role !== "assistant");

  return (
    <div className="absolute inset-x-0 top-0 bottom-[100px] overflow-hidden">
      <ScrollArea ref={scrollAreaRef} className="h-full w-full">
        <div className="flex flex-col items-center pt-4 pb-20">
          <div className="flex w-full max-w-4xl flex-col">
            {messagesWithTimestamps.map((message, index) => {
              const role = message.role as "user" | "assistant" | "system";

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
                  isDifferentDay(currentCreatedAt, previousCreatedAt));

              // Extract content from message
              const content = extractMessageContent(message);

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
              const coworkerId = selectedChat?.coworker?.id;
              const coworkerName = selectedChat?.coworker?.name;
              const coworkerFromList = coworkerId
                ? coworkers.find((c) => c.id === coworkerId)
                : undefined;
              const coworkerImageUrl =
                selectedChat?.coworker?.avatar ?? coworkerFromList?.avatar;
              const modelName = selectedChat?.model?.name;
              const modelId = selectedChat?.model?.id;

              const isLastMessage = index === messagesWithTimestamps.length - 1;
              const isStreaming =
                isLoading && isLastMessage && role === "assistant";

              return (
                <div
                  key={`${selectedChatId ?? "no-chat"}-${index}-${message.id ?? ""}`}
                >
                  {showDaySeparator && currentCreatedAt && (
                    <DaySeparator
                      date={currentCreatedAt}
                      formatDaySeparator={formatDaySeparator}
                    />
                  )}
                  <div className="mb-1">
                    <ChatMessage
                      role={role}
                      content={content}
                      userImageUrl={userImageUrl}
                      userName={userName}
                      createdAt={createdAt}
                      coworkerName={coworkerName}
                      coworkerId={coworkerId}
                      coworkerImageUrl={coworkerImageUrl}
                      modelName={modelName}
                      modelId={modelId}
                      isStreaming={isStreaming}
                    />
                  </div>
                </div>
              );
            })}
            {showLoadingIndicator && (
              <LoadingIndicator
                selectedChatId={selectedChatId}
                chats={chats}
                coworkers={coworkers}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
