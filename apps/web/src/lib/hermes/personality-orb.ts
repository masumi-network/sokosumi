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
  /** The orb's resting eyes when it isn't actively "thinking". */
  restExpression: OrbExpression;
}

/** Calm, neutral motion used when no personality has been chosen yet. */
export const DEFAULT_ORB_MOTION: OrbMotion = {
  speed: 1,
  restExpression: "idle",
};

/**
 * Maps a personality to orb motion. Playful + warm reads as faster, livelier
 * motion; high playfulness also tips the resting eyes into a smile. `detail`
 * does not affect the orb. Keep this the single source of truth — onboarding
 * and the chat both call it.
 */
export function personalityToOrbMotion(
  personality: HermesPersonality | null | undefined,
): OrbMotion {
  if (!personality) return DEFAULT_ORB_MOTION;
  const orbEnergy = (personality.style * 0.6 + personality.tone * 0.4) / 100;
  return {
    speed: 0.9 + orbEnergy * 1.2,
    restExpression: personality.style >= 60 ? "happy" : "idle",
  };
}
