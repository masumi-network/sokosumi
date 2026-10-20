/**
 * Whether a Soko Bot is personal. A personal bot has an owner; a shared bot
 * has none and belongs to a Project or to a whole workspace. Every
 * personal-or-shared branch goes through here, so a new scope changes one
 * place.
 */
export function isPersonalSokoBot<T extends { userId: string | null }>(
  bot: T,
): bot is T & { userId: string } {
  return bot.userId !== null;
}

/**
 * Whether a Soko Bot is shared. Unlike {@link isPersonalSokoBot} it does not
 * narrow, so it also reads a row whose type has no shared case yet.
 */
export function isSharedSokoBot(bot: { userId: string | null }): boolean {
  return !isPersonalSokoBot(bot);
}

/** A shared bot with a Project is a project bot; without one, a workspace bot. */
export function sharedSokoBotScopeKind(
  projectId: string | null,
): "project" | "workspace" {
  return projectId === null ? "workspace" : "project";
}
