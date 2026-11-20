"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { CoworkerFirstPrompt } from "@/app/chat/utils/coworker-first-prompts";

interface CoworkerFirstPromptsProps {
  coworkerName: string;
  prompts: CoworkerFirstPrompt[];
  /** Put the prompt in the composer to edit; never sends. */
  onPick: (text: string) => void;
}

/** Example first requests in an empty Coworker chat. */
export function CoworkerFirstPrompts({
  coworkerName,
  prompts,
  onPick,
}: CoworkerFirstPromptsProps) {
  const t = useTranslations("App.Channels.CoworkerFirstPrompts");
  const titleId = useId();
  if (prompts.length === 0) return null;

  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <p id={titleId} className="text-muted-foreground text-sm">
        {t("title", { name: coworkerName })}
      </p>
      <ul
        aria-labelledby={titleId}
        className="flex w-full flex-wrap justify-center gap-2"
      >
        {prompts.map((prompt) => (
          <li key={prompt.text} className="max-w-full min-w-0">
            <button
              type="button"
              title={prompt.text === prompt.label ? undefined : prompt.text}
              onClick={() => onPick(prompt.text)}
              className="border-border text-foreground hover:bg-accent focus-visible:ring-ring inline-flex h-8 max-w-full items-center rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2"
            >
              <span className="truncate">{prompt.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
