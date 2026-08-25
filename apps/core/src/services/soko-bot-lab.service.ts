import { Channel, type TaskStatus } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

export class SokoBotLabError extends Error {}

/**
 * Behaviour lab: act as the Coworker on a Task the bot delegated, so the
 * events sync wakes the bot and the lab can score how it reacts. Owner-
 * scoped; the event is attributed to the owner because no Coworker acted.
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
    select: { taskId: true },
  });
  const taskId = delegation?.taskId;
  if (!taskId) throw new SokoBotLabError("No delegated Task to simulate on");
  return serializableTransaction(async (tx) => {
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
    // Re-running the same simulated event must wake the bot again: rewind
    // what the events sync last saw to the status before this event.
    await tx.sokoBotDelegation.updateMany({
      where: { taskId: task.id },
      data: {
        lastSeenStatus: task.status === input.status ? "READY" : task.status,
      },
    });
    return { taskId: updated.id, name: updated.name, status: updated.status };
  }, "Soko Bot lab event collided with another action");
}
