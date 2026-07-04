import type { OrbExpression } from "@/lib/aurora-orb";

import type { HermesPersonality } from "./types";

/**
 * How the aurora orb should animate to reflect a chosen personality. Shared by
 * the onboarding hero (live slider preview) and the chat avatars so the two can
 * never drift apart.
 */
export interface OrbMotion {
  /** AuroraOrb `speed` multiplier — higher reads as livelier motion. */
  speed: number;
  /** Speed used while the assistant is actively working or using tools. */
  activeSpeed: number;
  /** Default duration for one-shot expression pulses. */
  pulseMs: number;
  /** The orb's resting eyes when it isn't actively "thinking". */
  restExpression: OrbExpression;
}

/** Calm, neutral motion used when no personality has been chosen yet. */
export const DEFAULT_ORB_MOTION: OrbMotion = {
  speed: 1,
  activeSpeed: 1.08,
  pulseMs: 1100,
  restExpression: "idle",
};

/**
 * Maps a personality to orb motion. Playful + warm reads as faster, livelier
 * motion, detail makes the assistant more deliberate, and low-detail/direct
 * personalities snap into active work a little faster. Keep this the single
 * source of truth — onboarding and the chat both call it.
 */
export function personalityToOrbMotion(
  personality: HermesPersonality | null | undefined,
): OrbMotion {
  if (!personality) return DEFAULT_ORB_MOTION;
  const warmth = personality.tone / 100;
  const playfulness = personality.style / 100;
  const detail = personality.detail / 100;
  const liveliness = playfulness * 0.6 + warmth * 0.4;
  const decisiveness = 1 - detail;
  return {
    speed: 0.85 + liveliness * 1.15 - detail * 0.12,
    activeSpeed: 0.9 + liveliness * 0.75 + decisiveness * 0.35,
    pulseMs: 850 + detail * 520 - playfulness * 120,
    restExpression:
      playfulness >= 0.66
        ? "happy"
        : warmth >= 0.68
          ? "content"
          : playfulness <= 0.25 && warmth <= 0.35
            ? "focused"
            : "idle",
  };
}
