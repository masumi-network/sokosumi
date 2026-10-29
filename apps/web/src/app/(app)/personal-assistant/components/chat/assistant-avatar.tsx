"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";

import { AuroraOrb } from "@/components/aurora-orb";
import { AvatarFace } from "@/components/soko-bot/avatar-face";
import type { OrbExpression } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

/** The bot's orb seed: its avatar in every assistant row and the header. */
export const AssistantSeedContext = createContext<string>("soko-bot");
/**
 * The bot's picture; when set it replaces the orb everywhere. `crafted` says
 * it is a scene to crop to the face, not a mascot that already is one.
 */
export const AssistantImageContext = createContext<{
  url: string;
  crafted: boolean;
} | null>(null);

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
  const image = useContext(AssistantImageContext);
  if (image) {
    return (
      <AvatarFace
        src={image.url}
        crafted={image.crafted}
        alt={t("avatarAlt")}
        className={cn(
          "ring-border ring-1",
          size === "lg" ? "size-20" : "size-8",
          className,
        )}
      />
    );
  }
  return (
    <AuroraOrb
      seed={seed}
      size={size === "lg" ? 160 : 64}
      animate={animated}
      expression={expression ?? null}
      alt={t("avatarAlt")}
      className={cn(
        "ring-border ring-1",
        size === "lg" ? "size-20" : "size-8",
        className,
      )}
    />
  );
}
