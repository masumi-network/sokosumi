import { getEnv } from "@/config/env";
import { networkStamp } from "@/helpers/preprod-control";
import prisma from "@/lib/db/prisma";
import {
  DetachedNetworkRefusal,
  detachedNetworkScopeForTick,
  turnProvenance,
} from "@/lib/soko-bot/detached-network";
import { INVOLVING_DELEGATION } from "@/lib/soko-bot/task-involvement";

const LOOKBACK_MS = 60 * 60 * 1_000;
const BATCH_SIZE = 100;

/**
 * A Coworker the bot delegated to may hand parts of the work to other
 * Coworkers as new Tasks (Elena starts Hannah's research and Alex's
 * dashboard). Core does not record which Task spawned them, so a Task a
 * Coworker created while the bot's delegated Task for the same owner was
 * RUNNING counts as part of that work: the bot follows it like its own
 * delegation and answers its plan approval instead of leaving it waiting.
 */
export async function adoptCoworkerSpawnedTasks(
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<number> {
  if (!getEnv().SOKO_BOT_ENABLED) return 0;
  let adopted = 0;
  let remaining = BATCH_SIZE;
  let after: { createdAt: Date; id: string } | undefined;
  const admission = detachedNetworkScopeForTick();
  while (remaining > 0 && shouldContinue()) {
    const pageSize = remaining;
    const spawnedTasks = await prisma.task.findMany({
      where: {
        createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
        creatorCoworkerId: { not: null },
        ownerId: { not: null },
        scheduleId: null,
        archivedAt: null,
        sokoBotDelegations: { none: INVOLVING_DELEGATION },
        ...(after
          ? {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        ownerId: true,
        workspaceId: true,
        assigneeId: true,
      },
    });
    for (const spawned of spawnedTasks) {
      if (!shouldContinue()) return adopted;
      remaining -= 1;
      const ownerId = spawned.ownerId;
      if (!ownerId) continue;
      const parents = await prisma.sokoBotDelegation.findMany({
        where: {
          kind: "TASK",
          ...INVOLVING_DELEGATION,
          turn: { sokoBot: { archivedAt: null } },
          task: {
            id: { not: spawned.id },
            ownerId,
            workspaceId: spawned.workspaceId,
            assigneeId: { not: null },
            createdAt: { lte: spawned.createdAt },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          turnId: true,
          turn: {
            select: { sokoBotId: true, network: true, preprodGeneration: true },
          },
          task: {
            select: {
              assigneeId: true,
              events: {
                where: {
                  status: { not: null },
                  createdAt: { lte: spawned.createdAt },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      });
      // A Coworker does not hand work to itself: Hannah's own running Task is
      // not where Hannah's new Task came from.
      const running = parents.filter(
        (parent) =>
          parent.task?.events[0]?.status === "RUNNING" &&
          parent.task.assigneeId !== spawned.assigneeId,
      );
      const byBot = new Map(
        running.map((parent) => [parent.turn.sokoBotId, parent]),
      );
      const rows = Array.from(byBot.values(), ({ turnId, turn }) => ({
        turn,
        data: {
          turnId,
          // Stored keys from before sub-tasks existed: rows already use them.
          toolCallId: `subtask:${spawned.id}`,
          kind: "TASK" as const,
          action: "follow_subtask",
          taskId: spawned.id,
        },
      }));
      // The Mainnet batch reads and locks nothing. A Preprod stamp must share
      // its transaction with the insert so its pause lock protects the write.
      const mainnet = rows.filter(({ turn }) => turn.network === "mainnet");
      let admitted = mainnet.length > 0;
      if (mainnet.length) {
        const created = await prisma.sokoBotDelegation.createMany({
          data: mainnet.map(({ data }) => ({ ...data, network: "mainnet" })),
          skipDuplicates: true,
        });
        adopted += created.count;
      }
      for (const { turn, data } of rows) {
        if (turn.network !== "preprod") continue;
        try {
          await admission.resume(turn);
          const created = await prisma
            .$transaction(async (tx) =>
              tx.sokoBotDelegation.createMany({
                data: {
                  ...data,
                  ...(await networkStamp(turnProvenance(turn), tx)),
                },
                skipDuplicates: true,
              }),
            )
            .catch((error: unknown) => {
              // A writer refusal can invalidate this tick's earlier read.
              if (error instanceof DetachedNetworkRefusal)
                admission.invalidate();
              throw error;
            });
          adopted += created.count;
          admitted = true;
        } catch (error) {
          if (!(error instanceof DetachedNetworkRefusal)) throw error;
        }
      }
      if (rows.length > 0 && !admitted) remaining += 1;
    }
    // Refused parents leave the spawned Task waiting. Scan past those Tasks
    // within this tick so they do not use a place in Mainnet's batch.
    if (spawnedTasks.length < pageSize) break;
    after = spawnedTasks.at(-1);
  }
  return adopted;
}
