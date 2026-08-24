"use client";

import { useTranslations } from "next-intl";

import { orderedMessageList } from "@/lib/intl/ordered-message-list";

import { AssistantAvatar } from "./assistant-avatar";

/** Empty timeline: greeting, one line of purpose, three starter prompts. */
export function WelcomeBlock({
  firstName,
  botName,
  onSelectSuggestion,
}: {
  firstName: string | null;
  botName: string;
  onSelectSuggestion: (prompt: string) => void;
}) {
  const t = useTranslations("App.SokoBot.Chat.welcome");
  const suggestions = orderedMessageList(
    t.raw("suggestions") as Record<string, string>,
  );
  const greeting = firstName
    ? t("titleNamed", { name: firstName })
    : t("title");

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-16">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
        <AssistantAvatar size="lg" animated expression="happy" />
        <h1 className="text-foreground mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {greeting}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed text-pretty md:text-base">
          {t("hint", { bot: botName })}
        </p>
        <div className="mt-8 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSelectSuggestion(prompt)}
              className="group/chip border-border bg-card hover:border-foreground/30 hover:bg-muted/40 text-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-2.5 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
            >
              <span className="truncate">{prompt}</span>
              <span
                aria-hidden
                className="text-muted-foreground group-hover/chip:text-primary shrink-0 transition-transform group-hover/chip:translate-x-0.5"
              >
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
