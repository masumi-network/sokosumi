import type { Prisma } from "@sokosumi/database";

import { conflict } from "@/helpers/error";
import {
  mapTaskFollowerRows,
  personalSokoBotWhere,
  taskFollowersInclude,
} from "@/helpers/task-follower-rows";

type Tx = Prisma.TransactionClient;

async function readFollowers(
  tx: Tx,
  task: { id: string; workspaceId: string },
) {
  const { followers } = await tx.task.findUniqueOrThrow({
    where: { id: task.id },
    select: taskFollowersInclude,
  });
  return mapTaskFollowerRows(task, followers);
}

/**
 * Follow a Task with your personal Soko Bot. Needs that bot in the Task's
 * workspace; while it is paused, the moments go to the bell. Does not touch the participant list. Idempotent: a repeat keeps
 * the first follow time.
 */
export async function followTask(
  tx: Tx,
  task: { id: string; workspaceId: string },
  userId: string,
) {
  const bot = await tx.sokoBot.findFirst({
    where: { userId, workspaceId: task.workspaceId, ...personalSokoBotWhere },
    select: { id: true },
  });
  if (!bot) {
    throw conflict("Set up your Soko Bot to follow this Task");
  }
  await tx.taskFollower.createMany({
    data: [{ taskId: task.id, userId }],
    skipDuplicates: true,
  });
  return readFollowers(tx, task);
}

/** Stop following. Not following is a no-op. Participation stays as it is. */
export async function unfollowTask(
  tx: Tx,
  task: { id: string; workspaceId: string },
  userId: string,
) {
  await tx.taskFollower.deleteMany({ where: { taskId: task.id, userId } });
  return readFollowers(tx, task);
}
