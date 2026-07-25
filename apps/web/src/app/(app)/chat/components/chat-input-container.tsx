"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { Dispatch, SetStateAction } from "react";

import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { cn } from "@/lib/utils";

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
    message: ChatComposeMessage,
    coworker?: Coworker,
    model?: { id: string; name: string },
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
  selectedModel: { id: string; name: string } | null;
  onSelectModel: (model: { id: string; name: string } | null) => void;
  selectedChatCoworker?: Coworker;
  coworkers?: Coworker[];
  mobileKeyboardOptimized?: boolean;
  persistentImageGeneration?: boolean;
  submitBlocked?: boolean;
  fullWidth?: boolean;
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
  persistentImageGeneration = false,
  submitBlocked = false,
  fullWidth = false,
}: ChatInputContainerProps) {
  return (
    <div
      className={cn(
        "bg-background/80 fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full shrink-0 justify-center overflow-visible pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:absolute md:inset-x-0 md:bottom-0",
        fullWidth ? "px-5" : "px-8",
      )}
    >
      <div
        className={cn(
          "w-full overflow-visible",
          fullWidth ? "max-w-none" : "max-w-4xl",
        )}
      >
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
          persistentImageGeneration={persistentImageGeneration}
          submitBlocked={submitBlocked}
        />
      </div>
    </div>
  );
}
