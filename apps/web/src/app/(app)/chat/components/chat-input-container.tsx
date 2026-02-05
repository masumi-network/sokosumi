"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { Dispatch, SetStateAction } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import type { Attachment } from "@/components/chat/preview-attachment";

interface ChatInputContainerProps {
  selectedChatId: string | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<UIMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: (
    attachments: Attachment[] | ((prev: Attachment[]) => Attachment[]),
  ) => void;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  onSendMessage: (
    message: string,
    coworker?: Coworker,
    model?: { id: string; name: string },
  ) => void;
  selectedModel: { id: string; name: string } | null;
  onSelectModel: (model: { id: string; name: string } | null) => void;
  selectedChatCoworker?: Coworker;
}

export default function ChatInputContainer({
  selectedChatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  onSendMessage,
  selectedModel,
  onSelectModel,
  selectedChatCoworker,
}: ChatInputContainerProps) {
  return (
    <div className="bg-background/80 absolute right-0 bottom-0 left-0 z-10 flex shrink-0 justify-center px-4 py-2 backdrop-blur-sm">
      <div className="w-full max-w-[33.6rem]">
        <MultimodalInput
          chatId={selectedChatId || undefined}
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
          showSuggestedActions={false}
          onSelectModel={onSelectModel}
          selectedModel={selectedModel}
          coworker={selectedChatCoworker}
        />
      </div>
    </div>
  );
}
