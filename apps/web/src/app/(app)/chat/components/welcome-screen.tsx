"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useMemo } from "react";
import {
  filterCoworkersForComposeKind,
  findDefaultCoworker,
  getCoworkerImageUrl,
} from "@/app/chat/utils/coworker-utils";
import type {
  ChatComposeKind,
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { TaskboardVisual } from "@/components/onboarding/taskboard-visual";
import { cn } from "@/lib/utils";
import type { TaskDesignMdAttachmentSeed } from "@/lib/utils/task-attachments";

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
  welcomeComposeKind?: ChatComposeKind;
  onWelcomeComposeKindChange?: (kind: ChatComposeKind) => void;
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
  initialDesignMdAttachment?: TaskDesignMdAttachmentSeed | null;
}

export default function WelcomeScreen({
  mobileKeyboardOptimized = false,
  showGreetingAndSuggestions = true,
  userName,
  onSendMessage,
  welcomeComposeKind = "chat",
  onWelcomeComposeKindChange,
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
  initialDesignMdAttachment = null,
}: WelcomeScreenProps) {
  const t = useTranslations("App.Chat.Chat");
  const tOnboarding = useTranslations("Onboarding.Dialog");
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
  const showSuggestions =
    promptsList.length > 0 &&
    selectedModel == null &&
    welcomeComposeKind !== "task";

  function handleSuggestionClick(text: string) {
    if (!text.trim() || !initialCoworker) return;
    void onSendMessage(text.trim(), initialCoworker, undefined, {
      kind: "chat",
    });
  }

  const isTaskWelcomeHeader = welcomeComposeKind === "task";
  const composeKindCoworkers = useMemo(
    () => filterCoworkersForComposeKind(coworkers ?? [], welcomeComposeKind),
    [coworkers, welcomeComposeKind],
  );
  const visualCoworker =
    initialCoworker ?? findDefaultCoworker(composeKindCoworkers) ?? undefined;
  const visualCoworkerName = visualCoworker?.name ?? "";
  const visualCoworkerAvatarUrl = visualCoworker
    ? (getCoworkerImageUrl(
        visualCoworker.slug ?? visualCoworker.id,
        visualCoworker.avatar ?? undefined,
      ) ?? "/images/coworkers/elena.webp")
    : null;

  return (
    <div className="relative flex h-full w-full flex-col">
      {showGreetingAndSuggestions ? (
        <div className="mt-[-200px] flex flex-1 flex-col items-center justify-center text-center">
          <div className="welcome-message-block transition-all duration-300 ease-out">
            <h1 className="mb-2 text-3xl font-medium">
              {isTaskWelcomeHeader
                ? userName
                  ? t("welcomeScreen.taskGreetingWithName", { name: userName })
                  : t("welcomeScreen.taskGreeting")
                : userName
                  ? t("welcomeScreen.greetingWithName", { name: userName })
                  : t("welcomeScreen.greeting")}
            </h1>
            <p className="text-muted-foreground text-2xl">
              {isTaskWelcomeHeader
                ? t("welcomeScreen.taskQuestion")
                : t("welcomeScreen.question")}
            </p>
          </div>
          {isTaskWelcomeHeader && visualCoworker && visualCoworkerAvatarUrl ? (
            <div
              aria-hidden
              className="mt-6 w-full max-w-88 overflow-hidden rounded-2xl border bg-muted/40"
            >
              <div className="h-44">
                <TaskboardVisual
                  key={`${visualCoworker.id}-task-preview`}
                  avatarAlt={tOnboarding("alt.coworkerAvatar", {
                    name: visualCoworkerName,
                  })}
                  avatarUrl={visualCoworkerAvatarUrl}
                  coworkerName={visualCoworkerName}
                  taskTitle={tOnboarding("visuals.taskboard.taskTitle")}
                  todoLabel={tOnboarding("visuals.taskboard.todo")}
                  inProgressLabel={tOnboarding("visuals.taskboard.inProgress")}
                />
              </div>
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
      ) : null}
      <div
        aria-hidden
        className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-5 h-32 bg-linear-to-t to-transparent"
      />
      <div className="bg-background/80 fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full shrink-0 justify-center px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:absolute md:inset-x-0 md:bottom-0 md:px-0">
        <div className="w-full max-w-4xl">
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
            controlledComposeKind={welcomeComposeKind}
            onComposeKindChange={onWelcomeComposeKindChange}
            showSuggestedActions={true}
            coworkers={coworkers}
            coworkersLoading={coworkersLoading}
            coworker={initialCoworker}
            onCoworkerChange={onCoworkerChange}
            selectedModel={selectedModel ?? undefined}
            onSelectModel={onSelectModel}
            initialDesignMdAttachment={initialDesignMdAttachment}
          />
        </div>
      </div>
    </div>
  );
}
