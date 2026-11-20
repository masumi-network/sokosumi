"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { CoworkerFirstPrompt } from "@/app/chat/utils/coworker-first-prompts";
import { Button } from "@/components/ui/button";

interface CoworkerFirstPromptsProps {
  coworkerName: string;
  prompts: CoworkerFirstPrompt[];
  /** Add the prompt to the composer to edit; never sends. */
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPick(prompt.text)}
              className="h-auto min-h-8 max-w-full rounded-full py-1.5 text-start font-normal whitespace-normal wrap-anywhere text-pretty"
            >
              {prompt.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
