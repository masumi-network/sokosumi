import { Channel, type TaskStatus } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { buildEventMessage } from "@/services/soko-bot-events-sync.service";

export class SokoBotLabError extends Error {}

/**
 * Behaviour lab: act as the Coworker on a Task the bot delegated, then wake
 * the bot on it, so the lab can score how it reacts. Owner-scoped; the event
 * is attributed to the owner because no Coworker acted.
 *
 * The turn is started here rather than left to the one-minute events cron.
 * Waiting on the cron made every failure look the same — a bot at its daily
 * cap, a paused bot and a slow turn all showed up as "no turn appeared" after
 * five minutes — and it spent the owner's proactive allowance on lab runs,
 * which the allowance explicitly is not for. Starting it directly gives the
 * caller a turn id to follow and keeps the run out of that budget, the same
 * way every other lab scenario already works.
 */
export async function simulateSokoBotTaskEvent(input: {
  userId: string;
  workspaceId: string;
  taskId?: string;
  status: Extract<TaskStatus, "INPUT_REQUIRED" | "FAILED" | "COMPLETED">;
  comment: string;
}) {
  const bot = await prisma.sokoBot.findFirst({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!bot) throw new SokoBotLabError("Soko Bot not found");
  const delegation = await prisma.sokoBotDelegation.findFirst({
    where: {
      turn: { sokoBotId: bot.id },
      taskId: input.taskId ?? { not: null },
      task: { workspaceId: input.workspaceId, archivedAt: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, taskId: true },
  });
  const taskId = delegation?.taskId;
  if (!taskId) throw new SokoBotLabError("No delegated Task to simulate on");
  const simulated = await serializableTransaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, workspaceId: input.workspaceId },
      select: { id: true, name: true, status: true },
    });
    if (!task) throw new SokoBotLabError("Task not found");
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: input.status,
        comment: input.comment,
        channel: Channel.SOKOSUMI,
        userId: input.userId,
      },
    });
    const updated = await tx.task.update({
      where: { id: task.id },
      data: { status: input.status },
      select: { id: true, name: true, status: true },
    });
    // Marked as seen at the new status so the events cron does not wake the
    // bot a second time for the turn this function is about to start.
    await tx.sokoBotDelegation.updateMany({
      where: { taskId: task.id },
      data: { lastSeenStatus: input.status },
    });
    return {
      taskId: updated.id,
      name: updated.name,
      status: updated.status,
      previousStatus: task.status,
      delegationId: delegation.id,
    };
  }, "Soko Bot lab event collided with another action");

  const started = await sokoBotControlPlane.startTurn({
    userId: input.userId,
    workspaceId: input.workspaceId,
    // `lab:` keeps it out of the owner's proactive allowance, which is for
    // work the bot decided to do by itself.
    clientTurnId: `lab:event:${simulated.taskId}:${Date.now()}`,
    message: buildEventMessage([
      {
        delegationId: simulated.delegationId,
        kind: "TASK",
        entityId: simulated.taskId,
        name: simulated.name ?? "Untitled task",
        from: simulated.previousStatus,
        to: simulated.status,
        note: input.comment,
      },
    ]),
    source: "EVENT",
  });

  return {
    taskId: simulated.taskId,
    name: simulated.name,
    status: simulated.status,
    turnId: started.turnId,
  };
}
