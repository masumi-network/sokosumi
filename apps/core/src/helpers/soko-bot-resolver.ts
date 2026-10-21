import type { SokoBot } from "@sokosumi/database";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import prisma, { type DbClient } from "@/lib/db/prisma";

/** `me`: the caller's personal bot. `id`: one bot the caller may reach. */
export type SokoBotSelector =
  | { kind: "me" }
  | { kind: "id"; sokoBotId: string };

export const ME_SOKO_BOT: SokoBotSelector = { kind: "me" };

/** The bot row. `userId` is nullable ahead of the schema: a shared bot has no owner. */
export type ResolvedSokoBotRow = Omit<SokoBot, "userId"> & {
  userId: string | null;
};

/**
 * The bot a member means, or `null` when they may not reach it. `me` is the
 * member's personal bot, never a bot they pinned to a Project (CMO.xyz's
 * Cuso); an id is any bot the member may reach.
 */
export async function memberSokoBot(
  userId: string,
  workspaceId: string,
  selector: SokoBotSelector,
  client: DbClient = prisma,
): Promise<ResolvedSokoBotRow | null> {
  if (selector.kind === "me") {
    const bot = await client.sokoBot.findFirst({
      where: { userId, workspaceId, projectId: null, archivedAt: null },
    });
    return bot;
  }

  // Membership is read live: leaving the Organization revokes nothing on the
  // bot, so this is where a former member loses it.
  const found = await client.sokoBot.findFirst({
    where: {
      id: selector.sokoBotId,
      workspaceId,
      deletedAt: null,
      workspace: sokoBotWorkspaceAccessWhere(userId, workspaceId),
    },
    include: { workspace: { select: { organizationId: true } } },
  });
  if (!found) return null;
  const { workspace, ...row } = found;
  const bot: ResolvedSokoBotRow = row;
  // Someone else's personal bot answers like a missing one, so ids do not leak.
  const reachable = isPersonalSokoBot(bot)
    ? bot.userId === userId
    : workspace.organizationId !== null;
  return reachable ? bot : null;
}
