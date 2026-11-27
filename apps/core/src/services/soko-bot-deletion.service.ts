import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "@/helpers/chat-room-mention-status";
import { forfeitCusoProjectCredits } from "@/helpers/cuso-project-credits";
import { notFound } from "@/helpers/error";
import { cancelUnpublishedSocialPosts } from "@/helpers/social-post-quote";
import {
  applySokoBotRules,
  countSokoBotNetworkRows,
} from "@/helpers/soko-bot-deletion-crossing-rules";
import { assertSokoBotManagement } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  revokeCusoSubscription,
  revokeSubscriptionsLeftByEnding,
} from "@/services/polar-subscription-end.service";
import { revokeSokoBotIntegrationAccounts } from "@/services/soko-bot-integrations.service";

/**
 * Deleting a Soko Bot always erases everything the bot owned — turns, runtime
 * events, memory, schedules, integrations, installed skills, lab runs, nudges
 * and watches — cancels every Social post it made that has not gone out, and
 * always frees the owner's `(userId, workspaceId)` slot so
 * they can create a brand-new bot immediately.
 *
 * Whether the row itself survives depends on what else points at it:
 *
 * - `deleted`: nothing references the bot, so the row goes too.
 * - `tombstoned`: Tasks, task events, billing usage or chat messages still
 *   reference it. Those are other people's records and must keep resolving, so
 *   an emptied, renamed row stays behind. A shared bot with a room is always
 *   tombstoned, and its room is archived: members find it under Archived,
 *   and an org owner or admin can delete it. The partial unique
 *   index on `(userId, workspaceId) WHERE deleted_at IS NULL` is what lets it
 *   stay without blocking the owner's next bot.
 */
export type SokoBotDeletionOutcome = "deleted" | "tombstoned";

export interface SokoBotDeletionResult {
  outcome: SokoBotDeletionOutcome;
  /** Connected accounts that could not be revoked; the owner must clear these
   * with the provider themselves, so the caller has to be able to say so. */
  unrevokedIntegrations: string[];
  /** What kept the row alive, for the confirmation the caller shows. */
  retained: {
    tasks: number;
    taskEvents: number;
    billingRecords: number;
    chatMessages: number;
    /** Files it uploaded onto Tasks; they outlive the assistant. */
    uploadedTaskFiles: number;
    /** Task Schedules it created; the creator FK restricts a hard delete. */
    taskSchedules: number;
    /** Jobs it hired; the creator FK restricts a hard delete. */
    jobs: number;
    /** Social posts it made: published ones and the canceled rest. The
     * creator FK restricts a hard delete. */
    socialPosts: number;
  };
}

/** Everything the bot exclusively owns; none of it outlives the deletion. */
/** Archives a shared bot's room; returns who to tell, or null if it was already archived. */
async function archiveSharedRoom(
  tx: Prisma.TransactionClient,
  roomId: string,
): Promise<{ roomId: string; userIds: string[] } | null> {
  const archived = await tx.chatRoom.updateMany({
    where: { id: roomId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (archived.count === 0) return null;
  const members = await tx.chatRoomUserMember.findMany({
    where: { roomId },
    select: { userId: true },
  });
  return { roomId, userIds: members.map((member) => member.userId) };
}

async function eraseOwnedRecords(
  tx: Prisma.TransactionClient,
  sokoBotId: string,
): Promise<void> {
  // Turn children cascade from the turn, so deleting turns clears runtime
  // events, tool calls, delegations, context snapshots and lab-run turns.
  await tx.sokoBotTurn.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotMemoryRevision.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotSchedule.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotIntegration.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotInstalledSkill.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotLabRun.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotNudge.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotTaskWatch.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotPendingDecision.deleteMany({ where: { sokoBotId } });
  await tx.sokoBotLegacyMessage.deleteMany({ where: { sokoBotId } });
  await tx.coworkerApiKey.deleteMany({ where: { sokoBotId: sokoBotId } });
}

export async function deleteSokoBot(
  sokoBotId: string,
): Promise<SokoBotDeletionResult> {
  // Confirm the bot is really being deleted before touching anything remote.
  // Revoking first meant a bot that then failed to delete kept polling
  // credentials that had already been withdrawn.
  const live = await prisma.sokoBot.findFirst({
    where: { id: sokoBotId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!live) throw notFound("Soko Bot not found");

  // Polar stops charging for a live Cuso before he ends (ADR 0068). A
  // revoke Polar fails is owed to the sync job; the deletion goes on.
  await revokeCusoSubscription(live.id);

  const deleted = await serializableTransaction(async (tx) => {
    const bot = await tx.sokoBot.findFirst({
      where: { id: sokoBotId, deletedAt: null },
      select: { id: true, sharedRoomId: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    await tx.$queryRaw`
      SELECT "id"
      FROM ${sharedTable("soko_bot")}
      WHERE "id" = ${bot.id}::uuid
      FOR UPDATE
    `;

    // Connection persistence also locks this bot row. Capture its accounts
    // in the same transaction that prevents any further connection writes.
    const integrations = await tx.sokoBotIntegration.findMany({
      where: { sokoBotId: bot.id },
      select: {
        provider: true,
        composioAccountId: true,
        pendingComposioAccountId: true,
      },
    });

    // Both outcomes end a live Cuso; a hard delete keeps his Project, and so
    // its credits, so they are written off here (ADR 0067).
    await forfeitCusoProjectCredits(bot.id, tx);

    // Stop live work before erasing what it would write back into.
    await tx.sokoBotTurn.updateMany({
      where: { sokoBotId: bot.id, status: { in: ["STARTING", "RUNNING"] } },
      data: {
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date(),
      },
    });
    await eraseOwnedRecords(tx, bot.id);
    await cancelUnpublishedSocialPosts(tx, { creatorSokoBotId: bot.id });
    const mentionMessageIds = await failOpenChatRoomMentions(
      {
        where: { sokoBotId: bot.id },
        error: "Personal assistant is no longer a member of this room",
      },
      tx,
    );
    await tx.chatRoomSokoBotMember.deleteMany({
      where: { sokoBotId: bot.id },
    });

    // Sequential: Prisma forbids concurrent queries on one interactive tx (#2559).
    const createdTasks = await tx.task.count({
      where: { creatorSokoBotId: bot.id },
    });
    const assignedTasks = await tx.task.count({
      where: { assigneeSokoBotId: bot.id },
    });
    const taskEvents = await tx.taskEvent.count({
      where: { sokoBotId: bot.id },
    });
    // Usage rows and hired Jobs live in each Network that is on.
    const { billingRecords, jobs } = await countSokoBotNetworkRows(tx, bot.id);
    const chatMessages = await tx.chatRoomMessage.count({
      where: { senderSokoBotId: bot.id },
    });
    // A file the assistant uploaded outlives it on the Task. The FK is
    // ON DELETE SET NULL, so hard-deleting the bot would leave the file in
    // place with its uploader silently blanked — provenance nobody can
    // recover. Counting it keeps the tombstone.
    const uploadedTaskFiles = await tx.taskFile.count({
      where: { uploadedBySokoBotId: bot.id },
    });
    const taskSchedules = await tx.taskSchedule.count({
      where: { creatorSokoBotId: bot.id },
    });
    const socialPosts = await tx.socialPost.count({
      where: { creatorSokoBotId: bot.id },
    });
    const tasks = createdTasks + assignedTasks;

    const retained = {
      tasks,
      taskEvents,
      billingRecords,
      chatMessages,
      uploadedTaskFiles,
      taskSchedules,
      jobs,
      socialPosts,
    };

    if (
      bot.sharedRoomId === null &&
      tasks === 0 &&
      taskEvents === 0 &&
      billingRecords === 0 &&
      chatMessages === 0 &&
      uploadedTaskFiles === 0 &&
      taskSchedules === 0 &&
      jobs === 0 &&
      socialPosts === 0
    ) {
      await tx.sokoBot.delete({ where: { id: bot.id } });
      await applySokoBotRules(tx, bot.id);
      return {
        result: {
          outcome: "deleted" as const,
          retained,
        },
        mentionMessageIds,
        integrations,
        archivedRoom: null,
      };
    }

    // A tombstone never comes back, so its room would stay in every member's
    // list for good: archive it with the bot (SOKD-487).
    const archivedRoom = bot.sharedRoomId
      ? await archiveSharedRoom(tx, bot.sharedRoomId)
      : null;

    await tx.sokoBot.update({
      where: { id: bot.id },
      data: {
        deletedAt: new Date(),
        archivedAt: new Date(),
        status: "PAUSED",
        name: null,
        avatarSeed: null,
        avatarImageUrl: null,
        avatarCode: null,
        personalityTone: null,
        personalityDetail: null,
        personalityStyle: null,
        versionId: null,
        memoryVersion: 0,
        memoryHash: null,
        eveSessionId: null,
        runtimeVersion: null,
        runtimeDeployment: null,
        lastSandboxId: null,
        lastSandboxStatus: null,
        followWholeBoard: false,
        proactivePaused: true,
        lastBriefingAt: null,
        lastActivityAt: null,
        lastTurnAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveTurnFailures: 0,
        lastPolledAt: null,
        lastInboxMessageAt: null,
        lastSeenInboxAt: null,
        consecutivePollErrors: 0,
      },
    });
    return {
      result: {
        outcome: "tombstoned" as const,
        retained,
      },
      mentionMessageIds,
      integrations,
      archivedRoom,
    };
  }, "Soko Bot deletion collided with active work");
  if (deleted.archivedRoom)
    await publishChatRoomsChanged({
      ...deleted.archivedRoom,
      collections: ["active", "archived"],
    });
  await revokeSubscriptionsLeftByEnding(live.projectId);
  const revocation = await revokeSokoBotIntegrationAccounts(
    sokoBotId,
    deleted.integrations,
  );
  await publishChatRoomMentionStatuses(deleted.mentionMessageIds);
  return { ...deleted.result, unrevokedIntegrations: revocation.failed };
}

export async function deleteSokoBotForUser(
  userId: string,
  workspaceId: string,
  selector: SokoBotSelector = ME_SOKO_BOT,
): Promise<SokoBotDeletionResult> {
  // `me` also finds an archived bot: deleting is how an archived one goes away.
  const bot =
    selector.kind === "me"
      ? await prisma.sokoBot.findFirst({
          where: { userId, workspaceId, deletedAt: null },
          select: { id: true, userId: true, workspaceId: true },
        })
      : await memberSokoBot(userId, workspaceId, selector);
  if (!bot) throw notFound("Soko Bot not found");
  await assertSokoBotManagement(userId, bot, "delete");
  return deleteSokoBot(bot.id);
}
