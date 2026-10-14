import { MemberRole, type Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { isActiveUser } from "@/middleware/auth-active-user";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Who a turn that no member asked for directly could be for, most specific
 * first. A missing hint is skipped.
 */
export interface TurnAttributionHints {
  /**
   * The member a replayed turn ran for. A replay runs only for them: their
   * words must never run as anyone else, so there is no fallback.
   */
  replayUserId?: string | null;
  scheduleUserId?: string | null;
  /** The person behind the TaskEvent that woke the bot. */
  taskEventUserId?: string | null;
  /** The member who hired the Job that woke the bot. */
  jobOwnerId?: string | null;
  taskOwnerId?: string | null;
  /** A built-in rhythm: the bot's creator stands in before the OWNER. */
  systemRhythm?: boolean;
}

export interface TurnAttributionBot {
  userId: string | null;
  createdByUserId: string | null;
  workspace: { organizationId: string | null };
}

/** The `startTurn` fields for a self-started turn. */
export interface SokoBotTurnStarter {
  userId: string;
  /** Set for a shared bot, which has no `me` lookup. */
  sokoBotId?: string;
}

const LIVE_MEMBER_SELECT = {
  userId: true,
  user: { select: { banned: true, banExpires: true } },
} as const;

async function liveMemberIds(
  organizationId: string,
  userIds: string[],
  client: DbClient,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const members = await client.member.findMany({
    where: { organizationId, userId: { in: userIds } },
    select: LIVE_MEMBER_SELECT,
  });
  return new Set(
    members
      .filter((member) => isActiveUser(member.user))
      .map((member) => member.userId),
  );
}

/**
 * The member a self-started turn runs for, or `null` when nobody can.
 *
 * A personal bot always runs for its owner. A shared bot runs a replay only
 * for its original member. Otherwise it takes the first live member of its
 * Organization from the hints in order, the bot's creator for a built-in
 * rhythm, then the earliest Organization OWNER. Project access is workspace
 * membership (`requireProjectAccess`), so a project bot needs no extra check.
 */
export async function resolveTurnUserId(
  bot: TurnAttributionBot,
  hints: TurnAttributionHints,
  client: DbClient = prisma,
): Promise<string | null> {
  if (bot.userId !== null) return bot.userId;
  const organizationId = bot.workspace.organizationId;
  if (organizationId === null) return null;

  if (hints.replayUserId !== undefined) {
    const replay = hints.replayUserId;
    if (!replay) return null;
    const live = await liveMemberIds(organizationId, [replay], client);
    return live.has(replay) ? replay : null;
  }

  const candidates = [
    hints.scheduleUserId,
    hints.taskEventUserId,
    hints.jobOwnerId,
    hints.taskOwnerId,
    hints.systemRhythm ? bot.createdByUserId : null,
  ].filter((id): id is string => typeof id === "string" && id !== "");
  const live = await liveMemberIds(organizationId, candidates, client);
  const first = candidates.find((id) => live.has(id));
  if (first) return first;

  const owners = await client.member.findMany({
    where: { organizationId, role: MemberRole.OWNER },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: LIVE_MEMBER_SELECT,
  });
  return owners.find((owner) => isActiveUser(owner.user))?.userId ?? null;
}

/**
 * Who a self-started turn of this bot runs for, ready to spread into
 * `startTurn`, or `null` when the bot is gone or no member is left.
 */
export async function sokoBotTurnStarter(
  sokoBotId: string,
  hints: TurnAttributionHints,
  client: DbClient = prisma,
): Promise<SokoBotTurnStarter | null> {
  const bot = await client.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: {
      userId: true,
      createdByUserId: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!bot) return null;
  const userId = await resolveTurnUserId(bot, hints, client);
  if (userId === null) return null;
  return bot.userId === null ? { userId, sokoBotId } : { userId };
}
