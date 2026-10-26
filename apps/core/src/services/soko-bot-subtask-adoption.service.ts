import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
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
export async function adoptCoworkerSubtasks(now = new Date()): Promise<number> {
  if (!getEnv().SOKO_BOT_ENABLED) return 0;
  const subtasks = await prisma.task.findMany({
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
  for (const subtask of subtasks) {
    const ownerId = subtask.ownerId;
    if (!ownerId) continue;
    const parents = await prisma.sokoBotDelegation.findMany({
      where: {
        kind: "TASK",
        ...INVOLVING_DELEGATION,
        turn: { sokoBot: { archivedAt: null } },
        task: {
          id: { not: subtask.id },
          ownerId,
          workspaceId: subtask.workspaceId,
          assigneeId: { not: null },
          createdAt: { lte: subtask.createdAt },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        turnId: true,
        turn: { select: { sokoBotId: true } },
        task: {
          select: {
            assigneeId: true,
            events: {
              where: {
                status: { not: null },
                createdAt: { lte: subtask.createdAt },
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
        parent.task.assigneeId !== subtask.assigneeId,
    );
    const byBot = new Map(running.map((p) => [p.turn.sokoBotId, p.turnId]));
    if (!byBot.size) continue;
    const created = await prisma.sokoBotDelegation.createMany({
      data: Array.from(byBot.values(), (turnId) => ({
        turnId,
        toolCallId: `subtask:${subtask.id}`,
        kind: "TASK" as const,
        action: "follow_subtask",
        taskId: subtask.id,
      })),
      skipDuplicates: true,
    });
    adopted += created.count;
  }
  return adopted;
}
