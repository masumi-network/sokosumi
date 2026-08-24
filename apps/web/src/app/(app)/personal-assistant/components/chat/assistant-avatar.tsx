"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";

import { AuroraOrb } from "@/components/aurora-orb";
import type { OrbExpression } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

/** The bot's orb seed: its avatar in every assistant row and the header. */
export const AssistantSeedContext = createContext<string>("soko-bot");

export function AssistantAvatar({
  size = "sm",
  expression = "idle",
  animated = false,
  className,
}: {
  size?: "sm" | "lg";
  expression?: OrbExpression;
  /** Live canvas (one rAF loop); use for a single hero orb only. */
  animated?: boolean;
  className?: string;
}) {
  const t = useTranslations("App.SokoBot.Chat");
  const seed = useContext(AssistantSeedContext);
  return (
    <AuroraOrb
      seed={seed}
      size={size === "lg" ? 160 : 64}
      animate={animated}
      expression={expression}
      alt={t("avatarAlt")}
      className={cn(
        "ring-border/40 ring-1",
        size === "lg" ? "size-20" : "size-8",
        className,
      )}
    />
  );
}
