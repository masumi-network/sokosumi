import type { SokoBotTurnSource } from "@sokosumi/database";
import { forbidden } from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import prisma, { type DbClient } from "@/lib/db/prisma";

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

/**
 * Only a member's own chat request has an asking member. Every other source,
 * and a chat turn another bot asked for, started itself.
 */
export function isMemberAskedSokoBotTurn(turn: {
  source: string | null;
  chainDepth: number;
}): boolean {
  return turn.source === "CHAT" && turn.chainDepth === 0;
}

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
  if (isPersonalSokoBot(bot)) {
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
export async function authorizeSokoBotTurnAction(
  callerUserId: string,
  turn: {
    requestedByUserId: string | null;
    source: SokoBotTurnSource;
    chainDepth: number;
  },
  bot: ManagedSokoBot,
  client: DbClient = prisma,
): Promise<boolean> {
  if (isPersonalSokoBot(bot)) return turn.requestedByUserId === callerUserId;
  const role = await organizationRoleInWorkspace(
    callerUserId,
    bot.workspaceId,
    client,
  );
  if (role === null) return false;
  if (isOrganizationOwnerOrAdmin(role)) return true;
  if (!isMemberAskedSokoBotTurn(turn)) {
    throw forbidden(
      "Only an organization owner or admin can act on work a shared Soko Bot started itself",
    );
  }
  if (turn.requestedByUserId === callerUserId) return true;
  throw forbidden(
    "Only the member who asked, or an organization owner or admin, can act on this turn",
  );
}

async function mayAnswerSokoBotDecision(
  callerUserId: string,
  decision: {
    requestedByUserId: string | null;
    turn: { source: SokoBotTurnSource; chainDepth: number };
    sokoBot: ManagedSokoBot;
  },
  client: DbClient,
): Promise<boolean> {
  if (!isPersonalSokoBot(decision.sokoBot)) {
    return authorizeSokoBotTurnAction(
      callerUserId,
      {
        requestedByUserId: decision.requestedByUserId,
        source: decision.turn.source,
        chainDepth: decision.turn.chainDepth,
      },
      decision.sokoBot,
      client,
    );
  }
  if (decision.requestedByUserId === callerUserId) return true;
  const role = await organizationRoleInWorkspace(
    callerUserId,
    decision.sokoBot.workspaceId,
    client,
  );
  return role !== null && isOrganizationOwnerOrAdmin(role);
}

/**
 * A pending decision the caller may answer, or `null` when it is hidden from
 * them. The member who asked answers, and so may an Organization OWNER or
 * ADMIN; one nobody asked for only they can answer (ADR 0057).
 * `ownerConfirmed: false` is the bot's own policy accepting a proposal on its
 * turn, not a member answering: it stays with the turn's acting member.
 * `firstResolverUserId` is who answered first: a resumed decision keeps the
 * resolver its PROCESSING claim recorded.
 */
export async function findResolvableSokoBotDecision(
  callerUserId: string | null,
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
    ? callerUserId !== null &&
      (await mayAnswerSokoBotDecision(callerUserId, decision, client))
    : decision.requestedByUserId === callerUserId;
  if (!allowed) return null;
  return {
    ...decision,
    firstResolverUserId: decision.resolvedByUserId ?? callerUserId,
  };
}
