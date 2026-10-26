import type { Prisma } from "@sokosumi/database";
import { canManageSokoBot } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import prisma from "@/lib/db/prisma";
import {
  ACTIVE_TURN_STATUSES,
  FOREGROUND_TURN,
  safeMemoryRevision,
} from "@/services/soko-bot-control-plane.service";

/**
 * The bot a request reads. `me` keeps its single indexed read on the owner;
 * `id` resolves access first (live membership, someone else's personal bot
 * hidden) and then reads by id. An archived bot is visible by id, so its
 * console can offer reactivation; `me` hides it, as before.
 */
async function stateWhere(
  viewerUserId: string,
  workspaceId: string,
  selector: SokoBotSelector,
): Promise<Prisma.SokoBotWhereInput | null> {
  if (selector.kind === "me") {
    return { userId: viewerUserId, workspaceId, archivedAt: null };
  }
  const bot = await memberSokoBot(viewerUserId, workspaceId, selector);
  return bot ? { id: bot.id } : null;
}

/**
 * Is anything happening, in one indexed read for `me`.
 *
 * The console watches turns it did not start, so it has to poll often enough
 * to catch one that runs for a few seconds. Polling the full chat state that
 * often is not affordable, so this carries only what tells the client
 * whether to go and fetch it.
 */
export async function getSokoBotActivity(
  viewerUserId: string,
  workspaceId: string,
  selector: SokoBotSelector = ME_SOKO_BOT,
): Promise<{
  status: string;
  activeTurnId: string | null;
  lastTurnAt: Date | null;
} | null> {
  const where = await stateWhere(viewerUserId, workspaceId, selector);
  if (!where) return null;
  // One Prisma call, though not one SQL statement: the generator does not
  // enable `relationJoins`. Both predicates are indexed and the payload is
  // three columns, which is what makes it affordable to ask every couple of
  // seconds.
  const bot = await prisma.sokoBot.findFirst({
    where,
    select: {
      status: true,
      lastTurnAt: true,
      turns: {
        where: {
          ...FOREGROUND_TURN,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!bot) return null;
  return {
    status: bot.status,
    activeTurnId: bot.turns[0]?.id ?? null,
    lastTurnAt: bot.lastTurnAt,
  };
}

/** The console's chat state, with whether the viewer may manage the bot. */
export async function getSokoBotState(
  viewerUserId: string,
  workspaceId: string,
  selector: SokoBotSelector = ME_SOKO_BOT,
) {
  const where = await stateWhere(viewerUserId, workspaceId, selector);
  if (!where) return null;
  const bot = await prisma.sokoBot.findFirst({
    where,
    include: {
      memoryRevisions: { orderBy: { version: "desc" }, take: 1 },
      legacyMessages: {
        orderBy: { createdAt: "desc" },
        take: 200,
      },
      pendingDecisions: {
        where: { status: "PENDING", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      schedules: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!bot) return null;
  const memoryRevisions = (bot.memoryRevisions ?? []).map(safeMemoryRevision);
  return {
    ...bot,
    memoryHash: memoryRevisions[0]?.hash ?? bot.memoryHash,
    memoryRevisions,
    viewerCanManage: await canManageSokoBot(viewerUserId, bot),
  };
}

/**
 * Project and workspace bots of a workspace the viewer belongs to, archived
 * ones included so a manager can reactivate them. Deleted bots stay hidden.
 */
export async function listSharedSokoBots(
  viewerUserId: string,
  workspaceId: string,
) {
  const bots = await prisma.sokoBot.findMany({
    where: {
      workspaceId,
      userId: null,
      deletedAt: null,
      workspace: {
        ...sokoBotWorkspaceAccessWhere(viewerUserId, workspaceId),
        organizationId: { not: null },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      name: true,
      projectId: true,
      avatarSeed: true,
      avatarImageUrl: true,
      status: true,
      archivedAt: true,
      sharedRoomId: true,
    },
  });
  const first = bots[0];
  // One role read covers every bot: they share the workspace's Organization.
  const viewerCanManage = first
    ? await canManageSokoBot(viewerUserId, first)
    : false;
  return bots.map(({ userId: _userId, workspaceId: _workspaceId, ...bot }) => ({
    ...bot,
    scope:
      bot.projectId === null ? ("workspace" as const) : ("project" as const),
    viewerCanManage,
  }));
}
