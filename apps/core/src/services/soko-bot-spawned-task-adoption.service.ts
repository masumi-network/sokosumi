import { getEnv } from "@/config/env";
import { networkStamp } from "@/helpers/preprod-control";
import prisma from "@/lib/db/prisma";
import {
  DetachedNetworkRefusal,
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
): Promise<number> {
  if (!getEnv().SOKO_BOT_ENABLED) return 0;
  const spawnedTasks = await prisma.task.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
      creatorCoworkerId: { not: null },
      ownerId: { not: null },
      scheduleId: null,
      archivedAt: null,
      sokoBotDelegations: { none: INVOLVING_DELEGATION },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      createdAt: true,
      ownerId: true,
      workspaceId: true,
      assigneeId: true,
    },
  });
  let adopted = 0;
  for (const spawned of spawnedTasks) {
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
        const created = await prisma.$transaction(async (tx) =>
          tx.sokoBotDelegation.createMany({
            data: {
              ...data,
              ...(await networkStamp(turnProvenance(turn), tx)),
            },
            skipDuplicates: true,
          }),
        );
        adopted += created.count;
      } catch (error) {
        if (!(error instanceof DetachedNetworkRefusal)) throw error;
      }
    }
  }
  return adopted;
}
