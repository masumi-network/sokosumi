import type { Prisma } from "@sokosumi/database";
import {
  personalSokoBotAuthContext,
  sharedSokoBotAuthContext,
} from "@/helpers/soko-bot-auth-context";
import type { SokoBotTurnMember } from "@/helpers/soko-bot-turn-authority";
import prisma from "@/lib/db/prisma";
import type { SokoBotAuthenticationContext } from "@/middleware/auth";

type DbClient = Prisma.TransactionClient | typeof prisma;

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
  const { workspace } = bot;
  if (workspace.id !== turn.workspaceId) return null;
  if (bot.userId !== null) {
    return bot.userId === turn.userId
      ? personalSokoBotAuthContext(turn, workspace)
      : null;
  }
  if (workspace.organizationId === null) return null;
  return sharedSokoBotAuthContext(
    { sokoBotId: turn.sokoBotId, projectId: bot.projectId },
    { id: workspace.id, organizationId: workspace.organizationId },
  );
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
