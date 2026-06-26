"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction } from "react";
import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { cn } from "@/lib/utils";

const PROMPT_KEYS = ["1", "2", "3"] as const;

interface WelcomeScreenProps {
  mobileKeyboardOptimized?: boolean;
  showGreetingAndSuggestions?: boolean;
  userName?: string;
  onSendMessage: (
    message: ChatComposeMessage,
    coworker?: Coworker,
    model?: { id: string; name: string },
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
  welcomeSendBlocked?: boolean;
  isTransitioning: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  status: "ready" | "streaming" | "submitted" | "error";
  stop: () => void;
  coworkers?: Coworker[];
  coworkersLoading?: boolean;
  initialCoworker?: Coworker;
  onCoworkerChange?: (coworker: Coworker | null) => void;
  selectedModel?: { id: string; name: string } | null;
  onSelectModel?: (model: { id: string; name: string } | null) => void;
}

export default function WelcomeScreen({
  mobileKeyboardOptimized = false,
  showGreetingAndSuggestions = true,
  userName,
  onSendMessage,
  welcomeSendBlocked = false,
  input,
  setInput,
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  coworkers,
  coworkersLoading,
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
  const promptsList = promptKey
    ? PROMPT_KEYS.map((key) => {
        const translationKey =
          `welcomeScreen.prompts.${promptKey}.${key}` as const;
        return t.has(translationKey) ? t(translationKey) : null;
      }).filter((x): x is string => Boolean(x))
    : [];
  const showSuggestions = promptsList.length > 0 && selectedModel == null;

  function handleSuggestionClick(text: string) {
    if (!text.trim() || !initialCoworker) return;
    void onSendMessage(text.trim(), initialCoworker, undefined, {
      kind: "chat",
    });
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {showGreetingAndSuggestions ? (
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
                        "group border-border/60 bg-muted/30 w-full rounded-xl border px-4 py-3 text-left text-sm",
                        "hover:border-primary hover:bg-muted/50 hover:shadow-sm transition-colors cursor-pointer",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                        "flex items-center justify-between gap-3",
                      )}
                    >
                      <span className="text-muted-foreground leading-snug">
                        {text}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
      <div
        aria-hidden
        className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-5 h-32 bg-linear-to-t to-transparent"
      />
      <div className="bg-background/80 fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full shrink-0 justify-center overflow-visible px-8 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:absolute md:inset-x-0 md:bottom-0">
        <div className="w-full max-w-4xl overflow-visible">
          <MultimodalInput
            blurOnSendOnMobile={mobileKeyboardOptimized}
            enterSubmitsOnMobile={!mobileKeyboardOptimized}
            input={input}
            setInput={setInput}
            status={status}
            stop={stop}
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            onSendMessage={onSendMessage}
            submitBlocked={welcomeSendBlocked}
            showSuggestedActions={true}
            coworkers={coworkers}
            coworkersLoading={coworkersLoading}
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
