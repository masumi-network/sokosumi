"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { cn } from "@/lib/utils";

const PROMPT_KEYS = ["1", "2", "3"] as const;

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
  initialCoworker?: Coworker;
  onCoworkerChange?: (coworker: Coworker) => void;
  selectedModel?: { id: string; name: string } | null;
  onSelectModel?: (model: { id: string; name: string } | null) => void;
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
  initialCoworker,
  onCoworkerChange,
  selectedModel,
  onSelectModel,
}: WelcomeScreenProps) {
  const t = useTranslations("App.Chat.Chat");
  const promptKey =
    initialCoworker?.slug?.toLowerCase() ||
    initialCoworker?.id?.toLowerCase() ||
    "";
  const promptsList =
    promptKey === "hannah" || promptKey === "elena"
      ? PROMPT_KEYS.map((key) =>
          t(`welcomeScreen.prompts.${promptKey}.${key}`),
        ).filter(Boolean)
      : [];
  const showSuggestions = promptsList.length > 0 && selectedModel == null;

  function handleSuggestionClick(text: string) {
    if (!text.trim() || !initialCoworker) return;
    onSendMessage(text.trim(), initialCoworker);
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="mt-[-200px] flex flex-1 flex-col items-center justify-center text-center">
        <div className="welcome-message-block transition-all duration-300 ease-out">
          <h1 className="mb-2 text-3xl font-medium">
            {userName
              ? t("welcomeScreen.greetingWithName", { name: userName })
              : t("welcomeScreen.greeting")}
          </h1>
          <p className="text-muted-foreground text-2xl">
            {t("welcomeScreen.question")}
          </p>
        </div>
        {promptsList.length > 0 && (
          <div
            key={`suggestions-${promptKey}`}
            className={cn(
              "w-full max-w-[33.6rem] overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
              showSuggestions
                ? "max-h-[500px] opacity-100"
                : "max-h-0 opacity-0",
            )}
          >
            <p className="text-muted-foreground mt-8 mb-2 text-xs font-medium">
              {t("welcomeScreen.suggestionsLabel")}
            </p>
            <ul className="flex flex-col gap-2">
              {promptsList.map((text, index) => (
                <li
                  key={`${promptKey}-${index}`}
                  className="welcome-suggestion-item"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => handleSuggestionClick(text)}
                    className={cn(
                      "border-border/60 bg-muted/30 w-full rounded-xl border px-4 py-3 text-left text-sm",
                      "hover:border-border hover:bg-muted/50 transition-colors",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                    )}
                  >
                    <span className="text-muted-foreground leading-snug">
                      {text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="bg-background/80 absolute bottom-0 z-10 mx-auto flex w-full shrink-0 justify-center backdrop-blur-sm">
        <div className="w-full">
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
            coworker={initialCoworker}
            onCoworkerChange={onCoworkerChange}
            selectedModel={selectedModel ?? undefined}
            onSelectModel={onSelectModel}
          />
        </div>
      </div>
    </div>
  );
}
