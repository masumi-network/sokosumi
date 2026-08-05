"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction } from "react";
import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import { chatMobileTabBarBottomOffset } from "./chat-mobile-tab-registry";

const PROMPT_KEYS = ["1", "2", "3"] as const;

interface WelcomeScreenProps {
  mobileKeyboardOptimized?: boolean;
  showGreetingAndSuggestions?: boolean;
  userName?: string;
  onSendMessage: (
    message: ChatComposeMessage,
    coworker?: Coworker,
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
}

export default function WelcomeScreen({
  mobileKeyboardOptimized = false,
  showGreetingAndSuggestions = true,
  userName,
  onSendMessage,
  welcomeSendBlocked = false,
  isTransitioning,
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
}: WelcomeScreenProps) {
  const t = useTranslations("App.Chat.Chat");
  const isApple = useIsApplePlatform();
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
  const showSuggestions = promptsList.length > 0;
  const isOpeningRoom = welcomeSendBlocked || isTransitioning;
  const coworkerName = initialCoworker?.name?.trim() || null;

  function handleSuggestionClick(text: string) {
    if (!text.trim() || !initialCoworker || isOpeningRoom) return;
    void onSendMessage(text.trim(), initialCoworker, {
      kind: "chat",
    });
  }

  return (
    <div
      className="relative flex h-full w-full flex-col"
      aria-busy={isOpeningRoom || undefined}
    >
      {showGreetingAndSuggestions ? (
        <div className="mt-[-200px] flex flex-1 flex-col items-center justify-center text-center">
          <div
            className={cn(
              "welcome-message-block transition-all duration-300 ease-out",
              isOpeningRoom && "opacity-60",
            )}
          >
            <h1 className="mb-2 text-3xl font-medium">
              {userName
                ? t("welcomeScreen.greetingWithName", { name: userName })
                : t("welcomeScreen.greeting")}
            </h1>
            <p className="text-muted-foreground text-2xl">
              {t("welcomeScreen.question")}
            </p>
          </div>

          {isOpeningRoom ? (
            <div
              className="text-muted-foreground mt-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-4 py-2 text-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              <span>
                {coworkerName
                  ? t("welcomeScreen.startingChat", { name: coworkerName })
                  : t("welcomeScreen.startingChatFallback")}
              </span>
            </div>
          ) : null}

          {promptsList.length > 0 && (
            <div
              key={`suggestions-${promptKey}`}
              className={cn(
                "w-full max-w-[33.6rem] overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
                showSuggestions
                  ? "max-h-[500px] opacity-100"
                  : "max-h-0 opacity-0",
                isOpeningRoom && "pointer-events-none opacity-50",
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
                      disabled={isOpeningRoom}
                      aria-disabled={isOpeningRoom || undefined}
                      className={cn(
                        "group border-border/60 bg-muted/30 w-full rounded-xl border px-4 py-3 text-left text-sm",
                        "hover:border-primary hover:bg-muted/50 hover:shadow-sm transition-colors",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                        "flex items-center justify-between gap-3",
                        isOpeningRoom ? "cursor-not-allowed" : "cursor-pointer",
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
      <div
        className={cn(
          "bg-background/80 fixed inset-x-0 z-10 mx-auto flex w-full shrink-0 justify-center overflow-visible px-8 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:absolute md:inset-x-0",
          chatMobileTabBarBottomOffset(isApple),
        )}
      >
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
            submitBlocked={isOpeningRoom}
            showSuggestedActions={true}
            coworkers={coworkers}
            coworkersLoading={coworkersLoading}
            coworker={initialCoworker}
            onCoworkerChange={isOpeningRoom ? undefined : onCoworkerChange}
          />
        </div>
      </div>
    </div>
  );
}
