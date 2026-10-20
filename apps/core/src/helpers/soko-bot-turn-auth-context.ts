import { sokoBotAuthContextFor } from "@/helpers/soko-bot-auth-context";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import type { SokoBotTurnMember } from "@/helpers/soko-bot-turn-authority";
import prisma, { type DbClient } from "@/lib/db/prisma";
import type { SokoBotAuthenticationContext } from "@/middleware/auth";

/** The bot columns that decide which principal a turn acts as. */
export interface SokoBotTurnPrincipal {
  userId: string | null;
  projectId: string | null;
  workspace: { id: string; organizationId: string | null };
}

/**
 * The context a turn's bot acts in, or `null` when the bot does not fit the
 * turn. A personal bot acts as its owner, who is the turn's member. A shared
 * bot acts as itself, so it never gets the member's private view.
 */
export function sokoBotTurnAuthContext(
  turn: SokoBotTurnMember,
  bot: SokoBotTurnPrincipal,
): SokoBotAuthenticationContext | null {
  if (bot.workspace.id !== turn.workspaceId) return null;
  if (isPersonalSokoBot(bot) && bot.userId !== turn.actingUserId) return null;
  return sokoBotAuthContextFor(turn.sokoBotId, bot, bot.workspace);
}

/** Loads the turn's bot and builds {@link sokoBotTurnAuthContext}. */
export async function loadSokoBotTurnAuthContext(
  turn: SokoBotTurnMember,
  client: DbClient = prisma,
): Promise<SokoBotAuthenticationContext | null> {
  const bot = await client.sokoBot.findUnique({
    where: { id: turn.sokoBotId },
    select: {
      userId: true,
      projectId: true,
      workspace: { select: { id: true, organizationId: true } },
    },
  });
  return bot ? sokoBotTurnAuthContext(turn, bot) : null;
}
