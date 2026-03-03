"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { Dispatch, SetStateAction } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";

interface ChatInputContainerProps {
  selectedChatId: string | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<UIMessage>["status"];
  stop: () => void;
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
  coworkers?: Coworker[];
  /** Enable mobile keyboard UX: Enter does not submit, blur on send. Used on /chat_test. */
  mobileKeyboardOptimized?: boolean;
}

export default function ChatInputContainer({
  selectedChatId,
  input,
  setInput,
  status,
  stop,
  messages,
  setMessages,
  sendMessage,
  onSendMessage,
  selectedModel,
  onSelectModel,
  selectedChatCoworker,
  coworkers,
  mobileKeyboardOptimized = false,
}: ChatInputContainerProps) {
  return (
    <div className="bg-background/80 absolute right-0 bottom-0 left-0 z-10 mx-auto flex w-full shrink-0 justify-center px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:px-0">
      <div className="w-full max-w-4xl">
        <MultimodalInput
          blurOnSendOnMobile={mobileKeyboardOptimized}
          chatId={selectedChatId || undefined}
          enterSubmitsOnMobile={!mobileKeyboardOptimized}
          input={input}
          setInput={setInput}
          status={status}
          stop={stop}
          messages={messages}
          setMessages={setMessages}
          sendMessage={sendMessage}
          onSendMessage={onSendMessage}
          showSuggestedActions={false}
          onSelectModel={onSelectModel}
          selectedModel={selectedModel}
          coworker={selectedChatCoworker}
          coworkers={coworkers}
        />
      </div>
    </div>
  );
}
