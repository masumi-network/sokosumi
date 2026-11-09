"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";

import { BotFace } from "@/components/soko-bot/bot-face";
import type { OrbExpression } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

/** The bot's orb seed: its avatar in every assistant row and the header. */
export const AssistantSeedContext = createContext<string>("soko-bot");
/** Picked Soko Bot avatar image; when set it replaces the orb everywhere. */
export const AssistantImageContext = createContext<string | null>(null);

export function AssistantAvatar({
  size = "sm",
  expression,
  animated = false,
  className,
}: {
  size?: "sm" | "lg";
  /** Eyes override; omit for the orb's resting look. */
  expression?: OrbExpression;
  /** Live canvas (one rAF loop); use for a single hero orb only. */
  animated?: boolean;
  className?: string;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const seed = useContext(AssistantSeedContext);
  const imageUrl = useContext(AssistantImageContext);
  return (
    <BotFace
      imageUrl={imageUrl}
      seed={seed}
      orbSize={size === "lg" ? 160 : 64}
      animate={animated}
      expression={expression}
      alt={t("avatarAlt")}
      className={cn(
        "ring-border ring-1",
        size === "lg" ? "size-20" : "size-8",
        className,
      )}
    />
  );
}
