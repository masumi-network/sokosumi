"use client";

import { useTranslations } from "next-intl";
import { useContext } from "react";
import type { OrbState } from "thinking-orbs";

import { DottedOrb } from "@/components/dotted-orb";
import type { OrbExpression } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

import {
  AssistantMotionContext,
  AssistantSeedContext,
} from "./assistant-context";

/**
 * The assistant's avatar in a thinking-orbs activity state — the same
 * dotted identity material as the resting avatar, in motion. Used by the
 * typing indicator (`solving`), the tool-progress block (`working`) and
 * the streaming reply row (`composing`).
 *
 * Renders a live canvas (one rAF loop) — use for the single active
 * indicator/streaming avatar, not for every message row.
 */
export function ThinkingOrbAvatar({
  state,
  expression,
  accent = false,
  className,
}: {
  /** thinking-orbs activity: working | searching | solving | listening | composing | shaping */
  state: OrbState;
  /** Eyes while in this state — defaults to the personality's resting eyes. */
  expression?: OrbExpression;
  accent?: boolean;
  className?: string;
}) {
  const tCommon = useTranslations("App.Hermes.Common");
  const seed = useContext(AssistantSeedContext);
  const motion = useContext(AssistantMotionContext);

  return (
    <DottedOrb
      seed={seed}
      size={32}
      animate
      state={state}
      speed={motion.activeSpeed}
      expression={expression ?? motion.restExpression}
      alt={tCommon("hermesAvatarAlt")}
      className={cn("size-8", accent ? "ring-border/80 ring-1" : "", className)}
    />
  );
}
