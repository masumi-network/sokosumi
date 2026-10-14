import type { Prisma, SokoBotTurnSource } from "@sokosumi/database";
import { forbidden } from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import prisma from "@/lib/db/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

/** The bot columns a management check reads. A shared bot has no `userId`. */
export interface ManagedSokoBot {
  userId: string | null;
  workspaceId: string;
}

/**
 * Actions on a shared bot that only an Organization OWNER or ADMIN may take.
 * Configuring needs only access, which resolving the bot already proved.
 */
export const SOKO_BOT_ADMIN_ACTIONS = {
  archive: "archive",
  delete: "delete",
  resetMemory: "reset the memory of",
} as const;

export type SokoBotAdminAction = keyof typeof SOKO_BOT_ADMIN_ACTIONS;

/** Only a member's own chat request has an asking member; every other source started itself. */
const MEMBER_ASKED_TURN_SOURCES: ReadonlySet<SokoBotTurnSource> = new Set([
  "CHAT",
]);

async function organizationRoleInWorkspace(
  userId: string,
  workspaceId: string,
  client: DbClient,
): Promise<string | null> {
  const member = await client.member.findFirst({
    where: { userId, organization: { workspace: { id: workspaceId } } },
    select: { role: true },
  });
  return member?.role ?? null;
}

/**
 * Archive, delete and memory reset. A personal bot: its owner, as today. A
 * shared bot: an OWNER or ADMIN of the bot's Organization, read live.
 */
export async function assertSokoBotManagement(
  viewerUserId: string,
  bot: ManagedSokoBot,
  action: SokoBotAdminAction,
  client: DbClient = prisma,
): Promise<void> {
  if (bot.userId !== null) {
    if (bot.userId === viewerUserId) return;
    throw forbidden("Only the owner can manage this Soko Bot");
  }
  const role = await organizationRoleInWorkspace(
    viewerUserId,
    bot.workspaceId,
    client,
  );
  if (role !== null && isOrganizationOwnerOrAdmin(role)) return;
  throw forbidden(
    `Only an organization owner or admin can ${SOKO_BOT_ADMIN_ACTIONS[action]} a shared Soko Bot`,
  );
}

/**
 * Who may answer a turn's pending decision or cancel the turn. `false` means
 * the turn stays hidden from the caller (answer as not found).
 *
 * Personal: only the turn's member, as today. Shared: an OWNER or ADMIN, or
 * the member who asked in chat. A turn the bot started itself has no asking
 * member, so only an OWNER or ADMIN may act on it.
 */
export async function assertSokoBotTurnAction(
  callerUserId: string,
  turn: { userId: string; source: SokoBotTurnSource },
  bot: ManagedSokoBot,
  client: DbClient = prisma,
): Promise<boolean> {
  if (bot.userId !== null) return turn.userId === callerUserId;
  const role = await organizationRoleInWorkspace(
    callerUserId,
    bot.workspaceId,
    client,
  );
  if (role === null) return false;
  if (isOrganizationOwnerOrAdmin(role)) return true;
  if (!MEMBER_ASKED_TURN_SOURCES.has(turn.source)) {
    throw forbidden(
      "Only an organization owner or admin can act on work a shared Soko Bot started itself",
    );
  }
  if (turn.userId === callerUserId) return true;
  throw forbidden(
    "Only the member who asked, or an organization owner or admin, can act on this turn",
  );
}

/**
 * A pending decision the caller may answer, or `null` when it is hidden from
 * them. `ownerConfirmed: false` is the bot's own policy accepting a proposal
 * on its turn, not a member answering: it stays with the turn's member.
 */
export async function findResolvableSokoBotDecision(
  callerUserId: string,
  decisionId: string,
  accepted: boolean,
  ownerConfirmed: boolean,
  client: DbClient = prisma,
) {
  const decision = await client.sokoBotPendingDecision.findFirst({
    where: {
      id: decisionId,
      status: accepted ? { in: ["PENDING", "PROCESSING"] } : "PENDING",
    },
    include: {
      turn: true,
      sokoBot: { select: { userId: true, workspaceId: true } },
    },
  });
  if (!decision) return null;
  const allowed = ownerConfirmed
    ? await assertSokoBotTurnAction(
        callerUserId,
        { userId: decision.userId, source: decision.turn.source },
        decision.sokoBot,
        client,
      )
    : decision.userId === callerUserId;
  return allowed ? decision : null;
}
