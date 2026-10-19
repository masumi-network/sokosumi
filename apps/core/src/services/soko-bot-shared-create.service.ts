import { Prisma } from "@sokosumi/database";
import {
  createEmptySokoBotMemory,
  renderSokoBotMemory,
} from "@sokosumi/soko-bot";
import { CHANNEL_SLUG_MAX_LENGTH, sanitizeChannelSlug } from "@sokosumi/utils";
import { forbidden } from "@/helpers/error";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import { assertSokoBotManagement } from "@/helpers/soko-bot-management";
import { memberSokoBot } from "@/helpers/soko-bot-resolver";
import prisma from "@/lib/db/prisma";
import { claimAvatar } from "@/services/soko-bot-avatar.service";
import {
  memoryHash,
  SokoBotNotFoundError,
  SokoBotValidationError,
} from "@/services/soko-bot-control-plane.service";
import { getDefaultSokoBotVersionId } from "@/services/soko-bot-version.service";

type Client = typeof prisma;

export interface CreateSharedSokoBotInput {
  callerUserId: string;
  workspaceId: string;
  /** Set for a project bot, null for a workspace bot. */
  projectId: string | null;
  name: string;
  avatarSeed?: string | null;
  avatarId?: string | null;
  personalityTone?: number | null;
  personalityDetail?: number | null;
  personalityStyle?: number | null;
  /** IANA timezone, validated by the route; the column default otherwise. */
  timezone?: string;
}

/** Unique per Organization: the bot id is in it, the name only reads well. */
export function sharedSokoBotRoomSlug(name: string, sokoBotId: string): string {
  const head = sanitizeChannelSlug(name).slice(
    0,
    CHANNEL_SLUG_MAX_LENGTH - sokoBotId.length - 1,
  );
  return `${head.replace(/-+$/, "") || "bot"}-${sokoBotId}`;
}

async function requireOrganizationId(
  workspaceId: string,
  client: Client,
): Promise<string> {
  const workspace = await client.workspace.findUnique({
    where: { id: workspaceId },
    select: { organizationId: true },
  });
  if (!workspace?.organizationId) {
    throw new SokoBotValidationError(
      "A shared Soko Bot needs an organization workspace",
    );
  }
  return workspace.organizationId;
}

/**
 * Whether the Project is open (neither closing nor closed) in this workspace,
 * with a no-op write on its row. A project close is SERIALIZABLE and takes its
 * snapshot before it waits on that row: a mere lock would let it miss the bot
 * this transaction makes live, while a write makes it fail and retry. A close
 * that committed first leaves no open row here.
 */
async function touchOpenProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const open = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "project" SET "closedAt" = "closedAt"
    WHERE "id" = ${projectId}::uuid
      AND "workspaceId" = ${workspaceId}::uuid
      AND "closingAt" IS NULL
      AND "closedAt" IS NULL
    RETURNING "id"
  `;
  return open.length > 0;
}

/**
 * A project or workspace bot and its shared room, in one transaction.
 *
 * READ COMMITTED, passed explicitly, and the organization row lock comes
 * first: the member join trigger takes a share lock on the same row, so a
 * member who joins concurrently either waits and then joins the new room
 * through the trigger, or commits first and is seen by the member read
 * below. A fixed snapshot (REPEATABLE READ, SERIALIZABLE) would miss them.
 */
export async function createSharedSokoBot(
  input: CreateSharedSokoBotInput,
  client: Client = prisma,
) {
  const name = input.name.trim();
  if (!name || name.length > 80) {
    throw new SokoBotValidationError("Soko Bot name must be 1-80 characters");
  }
  const organizationId = await requireOrganizationId(input.workspaceId, client);
  const markdown = renderSokoBotMemory(createEmptySokoBotMemory());
  const hash = memoryHash(markdown);
  const versionId = await getDefaultSokoBotVersionId();

  const created = await client.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "organization"
        WHERE "id" = ${organizationId}
        FOR NO KEY UPDATE
      `;
      // Before the Project write: a close locks the workspace and then the
      // Project, so taking the bot insert's workspace key share later would
      // deadlock against it.
      await tx.$queryRaw`
        SELECT 1 FROM "workspace"
        WHERE "id" = ${input.workspaceId}::uuid
        FOR KEY SHARE
      `;
      // A member delete takes no organization lock, and its leave trigger
      // cannot see this uncommitted room. Exit does need a counterpart (the
      // 20261016100200 migration comment says it does not): the row locks make
      // a delete wait for this commit, so its trigger then removes the leaver.
      const members = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "member"
        WHERE "organizationId" = ${organizationId}
        ORDER BY "createdAt"
        FOR KEY SHARE
      `;
      if (!members.some((member) => member.userId === input.callerUserId)) {
        throw forbidden(
          "Only a member of the organization can create a shared Soko Bot",
        );
      }
      if (
        input.projectId &&
        !(await touchOpenProject(tx, input.projectId, input.workspaceId))
      ) {
        throw new SokoBotValidationError(
          "The project is not an open project of this workspace",
        );
      }
      const bot = await tx.sokoBot.create({
        data: {
          userId: null,
          projectId: input.projectId,
          createdByUserId: input.callerUserId,
          workspaceId: input.workspaceId,
          name,
          versionId,
          avatarSeed: input.avatarSeed,
          personalityTone: input.personalityTone,
          personalityDetail: input.personalityDetail,
          personalityStyle: input.personalityStyle,
          ingestTimezone: input.timezone,
          memoryVersion: 1,
          memoryHash: hash,
        },
      });
      await tx.sokoBotMemoryRevision.create({
        data: {
          sokoBotId: bot.id,
          version: 1,
          hash,
          markdown,
          source: "created",
        },
      });
      const userIds = members.map((member) => member.userId);
      const room = await tx.chatRoom.create({
        data: {
          organizationId,
          createdByUserId: input.callerUserId,
          name,
          slug: sharedSokoBotRoomSlug(name, bot.id),
          // Public, so a member who left the room can join it again.
          discoverability: "public",
          userMembers: {
            create: userIds.map((userId) => ({ userId, access: "member" })),
          },
          readStates: { create: userIds.map((userId) => ({ userId })) },
          sokoBotMembers: { create: [{ sokoBotId: bot.id }] },
        },
        select: { id: true },
      });
      const shared = await tx.sokoBot.update({
        where: { id: bot.id },
        data: { sharedRoomId: room.id },
      });
      if (input.avatarId) await claimAvatar(bot.id, input.avatarId, tx);
      return shared;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  // Shared bots get their built-in rhythms switched off; a member turns them on.
  const { ensureSystemSchedules } = await import(
    "@/services/soko-bot-proactive.service"
  );
  await ensureSystemSchedules(created).catch((error) => {
    console.error("Soko Bot system schedules failed", {
      sokoBotId: created.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  return created;
}

/**
 * Brings an archived shared bot back: an OWNER or ADMIN only, the reverse of
 * archiving. Archiving took the bot out of every room, its own included, so
 * it rejoins its shared room. A closed project keeps its bot archived.
 */
export async function reactivateSharedSokoBot(
  callerUserId: string,
  workspaceId: string,
  sokoBotId: string,
  client: Client = prisma,
) {
  return client.$transaction(async (tx) => {
    const bot = await memberSokoBot(
      callerUserId,
      workspaceId,
      { kind: "id", sokoBotId },
      tx,
    );
    if (!bot || isPersonalSokoBot(bot)) {
      throw new SokoBotNotFoundError("Soko Bot not found");
    }
    await assertSokoBotManagement(callerUserId, bot, "reactivate", tx);
    if (bot.archivedAt === null) return bot;
    if (
      bot.projectId &&
      !(await touchOpenProject(tx, bot.projectId, workspaceId))
    ) {
      throw new SokoBotValidationError(
        "The project is closing or closed, so its Soko Bot stays archived",
      );
    }
    // Conditional, since the read above takes no lock: a deletion that
    // committed meanwhile leaves no row to bring back.
    const { count } = await tx.sokoBot.updateMany({
      where: { id: bot.id, deletedAt: null, archivedAt: { not: null } },
      data: {
        archivedAt: null,
        // A durable administrator pause survives reactivation.
        status: bot.adminPausedAt === null ? "IDLE" : undefined,
      },
    });
    if (count === 0) throw new SokoBotNotFoundError("Soko Bot not found");
    if (bot.sharedRoomId) {
      await tx.chatRoomSokoBotMember.upsert({
        where: {
          roomId_sokoBotId: { roomId: bot.sharedRoomId, sokoBotId: bot.id },
        },
        create: { roomId: bot.sharedRoomId, sokoBotId: bot.id },
        update: {},
      });
    }
    return tx.sokoBot.findUniqueOrThrow({ where: { id: bot.id } });
  });
}
