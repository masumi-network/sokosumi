import type { IntentChoiceId } from "./types";

/** Featured welcome coworkers that own try-asking starters. */
export type FeaturedCoworkerSlug = "alex" | "hannah" | "elena";

/**
 * Per-intent sample order. Each slug maps to
 * `tryAsking.prompts.<intent>.<slug>`. Elena leads for "not sure yet".
 */
export const TRY_ASKING_BY_INTENT: Record<
  IntentChoiceId,
  readonly FeaturedCoworkerSlug[]
> = {
  chat: ["hannah", "alex", "elena"],
  tasks: ["elena", "alex", "hannah"],
  either: ["elena", "hannah", "alex"],
};

export function tryAskingPromptKey(
  intent: IntentChoiceId,
  slug: FeaturedCoworkerSlug,
): `tryAsking.prompts.${IntentChoiceId}.${FeaturedCoworkerSlug}` {
  return `tryAsking.prompts.${intent}.${slug}`;
}
