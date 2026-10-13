import type { Prisma, SokoBot } from "@sokosumi/database";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import prisma from "@/lib/db/prisma";
import type { SokoBotAuthenticationContext } from "@/middleware/auth";

type DbClient = Prisma.TransactionClient | typeof prisma;

/** A member asking about a bot, by user id. A user auth context fits it. */
export interface SokoBotRequestUser {
  actor: "user";
  userId: string;
}

/** A member, or a Soko Bot key acting on itself. */
export type SokoBotRequestCaller =
  | SokoBotRequestUser
  | SokoBotAuthenticationContext;

/** `me`: the caller's personal bot. `id`: one bot the caller may reach. */
export type SokoBotSelector =
  | { kind: "me" }
  | { kind: "id"; sokoBotId: string };

export const ME_SOKO_BOT: SokoBotSelector = { kind: "me" };

/** The bot row. `userId` is nullable ahead of the schema: a shared bot has no owner. */
export type ResolvedSokoBotRow = Omit<SokoBot, "userId"> & {
  userId: string | null;
};

export interface ResolvedSokoBot {
  bot: ResolvedSokoBotRow;
  /** The member the request is for; `null` only for a shared bot's own key. */
  viewerUserId: string | null;
}

async function resolveForMember(
  userId: string,
  workspaceId: string,
  selector: SokoBotSelector,
  client: DbClient,
): Promise<ResolvedSokoBot | null> {
  if (selector.kind === "me") {
    const bot = await client.sokoBot.findFirst({
      where: { userId, workspaceId, archivedAt: null },
    });
    return bot ? { bot, viewerUserId: userId } : null;
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
  const reachable =
    bot.userId === null
      ? workspace.organizationId !== null
      : bot.userId === userId;
  return reachable ? { bot, viewerUserId: userId } : null;
}

async function resolveSharedKeySelf(
  caller: SokoBotAuthenticationContext,
  workspaceId: string,
  client: DbClient,
): Promise<ResolvedSokoBot | null> {
  const row = await client.sokoBot.findFirst({
    where: { id: caller.sokoBotId, workspaceId, deletedAt: null },
  });
  if (!row) return null;
  const bot: ResolvedSokoBotRow = row;
  return bot.userId === null ? { bot, viewerUserId: null } : null;
}

/**
 * The one answer to "which bot does this request mean": the bot row and the
 * member it is viewed for, or `null` when the caller may not reach it.
 *
 * A key only ever resolves its own bot. A personal key acts as its owner; a
 * shared key has no personal bot and no viewer.
 */
export async function resolveBotForRequest(
  caller: SokoBotRequestCaller,
  workspaceId: string,
  selector: SokoBotSelector,
  client: DbClient = prisma,
): Promise<ResolvedSokoBot | null> {
  if (caller.actor === "user") {
    return resolveForMember(caller.userId, workspaceId, selector, client);
  }
  if (selector.kind === "id" && selector.sokoBotId !== caller.sokoBotId) {
    return null;
  }
  if (caller.scope === "personal") {
    const resolved = await resolveForMember(
      caller.userId,
      workspaceId,
      selector,
      client,
    );
    return resolved?.bot.id === caller.sokoBotId ? resolved : null;
  }
  if (selector.kind === "me") return null;
  return resolveSharedKeySelf(caller, workspaceId, client);
}

/** {@link resolveBotForRequest} for a member, whose viewer is that member. */
export async function memberSokoBot(
  userId: string,
  workspaceId: string,
  selector: SokoBotSelector,
  client: DbClient = prisma,
): Promise<ResolvedSokoBotRow | null> {
  const resolved = await resolveForMember(
    userId,
    workspaceId,
    selector,
    client,
  );
  return resolved?.bot ?? null;
}
