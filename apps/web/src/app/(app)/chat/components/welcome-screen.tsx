"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";

interface WelcomeScreenProps {
  userName?: string;
  onSendMessage: (message: string, coworker?: Coworker) => void;
  isTransitioning: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  status: "ready" | "streaming" | "submitted" | "error";
  stop: () => void;
  coworkers?: Coworker[];
}

export default function WelcomeScreen({
  userName,
  onSendMessage,
  input,
  setInput,
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  coworkers,
}: WelcomeScreenProps) {
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
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            onSendMessage={onSendMessage}
            showSuggestedActions={true}
            coworkers={coworkers}
          />
        </div>
      </div>
    </div>
  );
}
