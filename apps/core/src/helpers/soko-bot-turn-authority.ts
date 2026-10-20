import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import {
  memberSokoBot,
  type ResolvedSokoBotRow,
} from "@/helpers/soko-bot-resolver";
import prisma, { type DbClient } from "@/lib/db/prisma";

/**
 * A turn's bot and the person the turn acts for (`sokoBotActingUserId`):
 * null when a shared bot acts on its own (ADR 0057).
 */
export interface SokoBotTurnMember {
  sokoBotId: string;
  actingUserId: string | null;
  workspaceId: string;
}

const SOKO_BOT_LIVENESS = {
  notArchived: (bot: ResolvedSokoBotRow) => bot.archivedAt === null,
  running: (bot: ResolvedSokoBotRow) =>
    bot.archivedAt === null && bot.status !== "PAUSED",
  runningNotAdminPaused: (bot: ResolvedSokoBotRow) =>
    bot.archivedAt === null &&
    bot.status !== "PAUSED" &&
    bot.adminPausedAt === null,
} satisfies Record<string, (bot: ResolvedSokoBotRow) => boolean>;

/**
 * How alive the bot must still be: `running` excludes an owner pause, and
 * `runningNotAdminPaused` also an administrator pause.
 */
export type SokoBotLiveness = keyof typeof SOKO_BOT_LIVENESS;

/** A shared bot acting on its own: in an Organization workspace, not deleted. */
async function ownSharedSokoBot(
  member: SokoBotTurnMember,
  client: DbClient,
): Promise<ResolvedSokoBotRow | null> {
  const found: ResolvedSokoBotRow | null = await client.sokoBot.findFirst({
    where: {
      id: member.sokoBotId,
      workspaceId: member.workspaceId,
      deletedAt: null,
      workspace: { organizationId: { not: null } },
    },
  });
  return found && isSharedSokoBot(found) ? found : null;
}

/**
 * The bot a turn runs, when it may still act for the turn's member, or `null`.
 *
 * The one rule for the runtime, delivery and the effect outbox: a personal bot
 * owned by that member, or a shared bot in an Organization workspace the member
 * still reaches. It is the resolver's `id` rule, so membership is read live and
 * a member who left loses a shared bot here. A turn that acts for nobody runs
 * only a shared bot, which then acts as itself.
 */
export async function sokoBotForTurnMember(
  member: SokoBotTurnMember,
  liveness: SokoBotLiveness,
  client: DbClient = prisma,
): Promise<ResolvedSokoBotRow | null> {
  const bot =
    member.actingUserId === null
      ? await ownSharedSokoBot(member, client)
      : await memberSokoBot(
          member.actingUserId,
          member.workspaceId,
          { kind: "id", sokoBotId: member.sokoBotId },
          client,
        );
  return bot && SOKO_BOT_LIVENESS[liveness](bot) ? bot : null;
}
