import { defaultOrbSeed } from "@/lib/aurora-orb";

/**
 * A Soko Bot's default orb seed. A personal bot's comes from its owner, as it
 * always has; a shared bot has no owner, so its own id seeds it.
 */
export function defaultSokoBotOrbSeed(bot: {
  id: string;
  owner?: { id: string } | null;
}): string {
  return defaultOrbSeed(bot.owner?.id ?? bot.id);
}
