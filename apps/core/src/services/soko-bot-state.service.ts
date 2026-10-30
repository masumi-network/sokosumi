import type { Prisma } from "@sokosumi/database";
import {
  avatarFields,
  avatarStateRelations,
  deriveAvatarState,
} from "@/helpers/soko-bot-avatar-state";
import { canManageSokoBot } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import prisma from "@/lib/db/prisma";
import { type AvatarState } from "@/lib/soko-bot-avatar/style";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
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
 * whether to go and fetch it, and the avatar state for a surface that shows
 * nothing else (the sidebar).
 */
export async function getSokoBotActivity(
  viewerUserId: string,
  workspaceId: string,
  selector: SokoBotSelector = ME_SOKO_BOT,
): Promise<{
  status: string;
  activeTurnId: string | null;
  lastTurnAt: Date | null;
  avatarState: AvatarState;
} | null> {
  const where = await stateWhere(viewerUserId, workspaceId, selector);
  if (!where) return null;
  // One Prisma call, though not one SQL statement: the generator does not
  // enable `relationJoins`. The predicates are indexed and the payload is a
  // few columns, which is what makes it affordable to ask every couple of
  // seconds.
  const bot = await prisma.sokoBot.findFirst({
    where,
    select: {
      id: true,
      status: true,
      lastTurnAt: true,
      archivedAt: true,
      adminPausedAt: true,
      pendingDecisions: avatarStateRelations().pendingDecisions,
      turns: {
        where: {
          ...FOREGROUND_TURN,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, completedAt: true },
      },
    },
  });
  if (!bot) return null;
  const activeTurn = bot.turns[0] ?? null;
  // With nothing running, "done" and "idle" turn on the latest settled turn.
  const latestTurn =
    activeTurn ??
    (await prisma.sokoBotTurn.findFirst({
      where: { sokoBotId: bot.id, ...FOREGROUND_TURN },
      orderBy: { createdAt: "desc" },
      select: { status: true, completedAt: true },
    }));
  const { disabled: availabilityDisabled } = await getSokoBotAvailability();
  return {
    status: bot.status,
    activeTurnId: activeTurn?.id ?? null,
    lastTurnAt: bot.lastTurnAt,
    avatarState: deriveAvatarState({
      status: bot.status,
      archivedAt: bot.archivedAt,
      adminPausedAt: bot.adminPausedAt,
      availabilityDisabled,
      latestTurn,
      hasOpenDecision: bot.pendingDecisions.length > 0,
    }),
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
      avatar: avatarStateRelations().avatar,
      turns: avatarStateRelations().turns,
    },
  });
  if (!bot) return null;
  const memoryRevisions = (bot.memoryRevisions ?? []).map(safeMemoryRevision);
  const { turns: _turns, avatar: avatarRow, ...rest } = bot;
  const { disabled: availabilityDisabled } = await getSokoBotAvailability();
  return {
    ...rest,
    ...avatarFields({ ...bot, avatar: avatarRow, availabilityDisabled }),
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
      adminPausedAt: true,
      ...avatarStateRelations(),
    },
  });
  const first = bots[0];
  // One role read covers every bot: they share the workspace's Organization.
  const viewerCanManage = first
    ? await canManageSokoBot(viewerUserId, first)
    : false;
  const { disabled: availabilityDisabled } = await getSokoBotAvailability();
  return bots.map((bot) => {
    const {
      userId: _userId,
      workspaceId: _workspaceId,
      adminPausedAt: _adminPausedAt,
      avatar: _avatar,
      turns: _turns,
      pendingDecisions: _pendingDecisions,
      ...rest
    } = bot;
    return {
      ...rest,
      ...avatarFields({ ...bot, availabilityDisabled }),
      scope:
        bot.projectId === null ? ("workspace" as const) : ("project" as const),
      viewerCanManage,
    };
  });
}

/**
 * `avatarState` and `avatar` for one bot by id, for responses that are built
 * from another read (the admin detail, which is redacted after loading).
 */
export async function getSokoBotAvatarFields(
  sokoBotId: string,
  availabilityDisabled?: boolean,
) {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: {
      status: true,
      archivedAt: true,
      adminPausedAt: true,
      avatarImageUrl: true,
      ...avatarStateRelations(),
    },
  });
  if (!bot) return {};
  const disabled =
    availabilityDisabled ?? (await getSokoBotAvailability()).disabled;
  return avatarFields({ ...bot, availabilityDisabled: disabled });
}
