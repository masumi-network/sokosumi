"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";

import { DottedOrb } from "@/components/dotted-orb";
import type { OrbExpression } from "@/lib/aurora-orb";
import {
  DEFAULT_ORB_MOTION,
  type OrbMotion,
} from "@/lib/hermes/personality-orb";
import { cn } from "@/lib/utils";

/** The committed orb seed — the assistant's avatar across the chat. */
export const AssistantSeedContext = createContext<string>("personal-assistant");

/**
 * The orb's personality-driven motion (liveliness + resting eyes), published to
 * the chat avatars the same way the seed is. Defaults to calm/neutral.
 */
export const AssistantMotionContext =
  createContext<OrbMotion>(DEFAULT_ORB_MOTION);

/**
 * The assistant's resting avatar in chat rows: a static frame of the dotted
 * identity orb. Activity (typing/tools/streaming) renders through
 * `ThinkingOrbAvatar`, which is the same material in motion.
 */
export function AssistantAvatar({
  accent = false,
  expression,
}: {
  accent?: boolean;
  /** Eyes override. Omit to use the personality's resting expression. */
  expression?: OrbExpression;
} = {}) {
  const tCommon = useTranslations("App.Hermes.Common");
  const seed = useContext(AssistantSeedContext);
  const motion = useContext(AssistantMotionContext);

  return (
    <DottedOrb
      seed={seed}
      size={64}
      expression={expression ?? motion.restExpression}
      alt={tCommon("hermesAvatarAlt")}
      className={cn(
        "size-8 ring-1",
        accent ? "ring-border/80" : "ring-border/40",
      )}
    />
  );
}
