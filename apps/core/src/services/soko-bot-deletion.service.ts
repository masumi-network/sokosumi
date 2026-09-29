import type { Prisma } from "@sokosumi/database";

import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "@/helpers/chat-room-mention-status";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { revokeSokoBotIntegrationAccounts } from "@/services/soko-bot-integrations.service";

/**
 * Deleting a Soko Bot always erases everything the bot owned — turns, runtime
 * events, memory, schedules, integrations, installed skills, lab runs, nudges
 * and watches — and always frees the owner's `(userId, workspaceId)` slot so
 * they can create a brand-new bot immediately.
 *
 * Whether the row itself survives depends on what else points at it:
 *
 * - `deleted`: nothing references the bot, so the row goes too.
 * - `tombstoned`: Tasks, task events, billing usage or chat messages still
 *   reference it. Those are other people's records and must keep resolving, so
 *   an emptied, renamed row stays behind. The partial unique index on
 *   `(userId, workspaceId) WHERE deleted_at IS NULL` is what lets it stay
 *   without blocking the owner's next bot.
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
  };
}

/** Everything the bot exclusively owns; none of it outlives the deletion. */
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
    select: { id: true },
  });
  if (!live) throw notFound("Soko Bot not found");

  const deleted = await serializableTransaction(async (tx) => {
    const bot = await tx.sokoBot.findFirst({
      where: { id: sokoBotId, deletedAt: null },
      select: { id: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    await tx.$queryRaw`
      SELECT "id"
      FROM "soko_bot"
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

    // Stop live work before erasing what it would write back into.
    await tx.sokoBotTurn.updateMany({
      where: { sokoBotId: bot.id, status: { in: ["STARTING", "RUNNING"] } },
      data: {
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date(),
      },
    });
    await eraseOwnedRecords(tx, bot.id);
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
    const billingRecords = await tx.sokoBotUsage.count({
      where: { sokoBotId: bot.id },
    });
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
    const tasks = createdTasks + assignedTasks;

    const retained = {
      tasks,
      taskEvents,
      billingRecords,
      chatMessages,
      uploadedTaskFiles,
      taskSchedules,
    };

    if (
      tasks === 0 &&
      taskEvents === 0 &&
      billingRecords === 0 &&
      chatMessages === 0 &&
      uploadedTaskFiles === 0 &&
      taskSchedules === 0
    ) {
      await tx.sokoBot.delete({ where: { id: bot.id } });
      return {
        result: {
          outcome: "deleted" as const,
          retained,
        },
        mentionMessageIds,
        integrations,
      };
    }

    await tx.sokoBot.update({
      where: { id: bot.id },
      data: {
        deletedAt: new Date(),
        archivedAt: new Date(),
        status: "PAUSED",
        name: null,
        avatarSeed: null,
        avatarImageUrl: null,
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
    };
  }, "Soko Bot deletion collided with active work");
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
): Promise<SokoBotDeletionResult> {
  const bot = await prisma.sokoBot.findFirst({
    where: { userId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!bot) throw notFound("Soko Bot not found");
  return deleteSokoBot(bot.id);
}
