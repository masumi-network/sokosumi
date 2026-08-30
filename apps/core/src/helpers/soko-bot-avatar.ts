/**
 * A Soko Bot has no uploaded image: the web renders a deterministic orb from
 * this seed. `avatarSeed` is null for every bot that has not chosen one — which
 * is all of them, since nothing writes the column yet — so the owner's user id
 * is the stable fallback that gives each bot its own face.
 *
 * Single source for the rule. Chat derived it and the task API did not, so the
 * same assistant wore its real orb in a room and a blank one on a Task.
 */
export function sokoBotOrbSeed(bot: {
  userId: string;
  avatarSeed: string | null;
}): string {
  return bot.avatarSeed ?? `orb:${bot.userId}`;
}
