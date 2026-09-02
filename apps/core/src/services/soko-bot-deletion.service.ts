import type { Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { revokeAllSokoBotIntegrations } from "@/services/soko-bot-integrations.service";

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

  // Revoke before the rows go: deleting the local pointer first would leave the
  // account registered with the provider and remove the owner's only way to
  // disconnect it. Outside the transaction because it is a remote call.
  const revocation = await revokeAllSokoBotIntegrations(sokoBotId);

  return serializableTransaction(async (tx) => {
    const bot = await tx.sokoBot.findFirst({
      where: { id: sokoBotId, deletedAt: null },
      select: { id: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    await tx.$queryRaw`
      SELECT "id"
      FROM "orchestrator"
      WHERE "id" = ${bot.id}::uuid
      FOR UPDATE
    `;

    // Stop live work before erasing what it would write back into.
    await tx.sokoBotTurn.updateMany({
      where: { sokoBotId: bot.id, status: { in: ["STARTING", "RUNNING"] } },
      data: { status: "CANCEL_REQUESTED", cancellationRequestedAt: new Date() },
    });
    await eraseOwnedRecords(tx, bot.id);
    await tx.chatRoomOrchestratorMember.deleteMany({
      where: { orchestratorId: bot.id },
    });

    const [
      createdTasks,
      assignedTasks,
      taskEvents,
      billingRecords,
      chatMessages,
    ] = await Promise.all([
      tx.task.count({ where: { creatorOrchestratorId: bot.id } }),
      tx.task.count({ where: { assigneeOrchestratorId: bot.id } }),
      tx.taskEvent.count({ where: { orchestratorId: bot.id } }),
      tx.orchestratorUsage.count({ where: { orchestratorId: bot.id } }),
      tx.chatRoomMessage.count({
        where: { senderOrchestratorId: bot.id },
      }),
    ]);
    const tasks = createdTasks + assignedTasks;

    const retained = { tasks, taskEvents, billingRecords, chatMessages };
    const unrevokedIntegrations = revocation.failed;

    if (
      tasks === 0 &&
      taskEvents === 0 &&
      billingRecords === 0 &&
      chatMessages === 0
    ) {
      await tx.sokoBot.delete({ where: { id: bot.id } });
      return { outcome: "deleted" as const, retained, unrevokedIntegrations };
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
    return { outcome: "tombstoned" as const, retained, unrevokedIntegrations };
  }, "Soko Bot deletion collided with active work");
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
