import type { Prisma } from "@sokosumi/database";
import {
  memberSokoBot,
  type ResolvedSokoBotRow,
} from "@/helpers/soko-bot-resolver";
import prisma from "@/lib/db/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

/** A turn's bot and the member the turn runs for. */
export interface SokoBotTurnMember {
  sokoBotId: string;
  userId: string;
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

/**
 * The bot a turn runs, when it may still act for the turn's member, or `null`.
 *
 * The one rule for the runtime, delivery and the effect outbox: a personal bot
 * owned by that member, or a shared bot in an Organization workspace the member
 * still reaches. It is the resolver's `id` rule, so membership is read live and
 * a member who left loses a shared bot here.
 */
export async function sokoBotForTurnMember(
  member: SokoBotTurnMember,
  liveness: SokoBotLiveness,
  client: DbClient = prisma,
): Promise<ResolvedSokoBotRow | null> {
  const bot = await memberSokoBot(
    member.userId,
    member.workspaceId,
    { kind: "id", sokoBotId: member.sokoBotId },
    client,
  );
  return bot && SOKO_BOT_LIVENESS[liveness](bot) ? bot : null;
}
