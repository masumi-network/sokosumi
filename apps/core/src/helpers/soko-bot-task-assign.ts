import { type Prisma, TaskVisibility } from "@sokosumi/database";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import prisma from "@/lib/db/prisma";
import type { TaskAssigner } from "./access-control";
import { forbidden, notFound } from "./error";

/** The Task a member hands to a shared bot, as it will be after the write. */
export type AssignedTask = {
  visibility: TaskVisibility;
  projectId: string | null;
};

/**
 * Owner (or the PA itself) may assign a Task onto a live Soko Bot in this
 * workspace. Marketplace coworkers cannot dump work onto another user's PA.
 *
 * A shared bot sees PUBLIC data in its scope only, and its EVENT turns trust
 * what this gate lets through. So a member may hand it a Task only when the
 * caller passes that Task and it is PUBLIC and in scope: the bot's Project for
 * a project bot, any Project for a workspace bot. A caller that cannot name
 * the Task (schedules) stays refused.
 */
export async function requireTaskAssignableSokoBot(
  sokoBotId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
  assigner: TaskAssigner = null,
  task?: AssignedTask,
): Promise<void> {
  const bot = await tx.sokoBot.findFirst({
    where: {
      id: sokoBotId,
      workspaceId,
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true, userId: true, projectId: true },
  });
  if (!bot) {
    throw notFound("Soko Bot is not usable in this workspace");
  }
  if (!assigner) return;
  if (assigner.kind === "soko_bot" && bot.id === assigner.sokoBotId) return;
  if (isPersonalSokoBot(bot)) {
    if (assigner.kind === "user" && bot.userId === assigner.userId) return;
    throw forbidden("Only the owner can assign work to this Soko Bot");
  }
  if (
    assigner.kind === "user" &&
    task !== undefined &&
    task.visibility === TaskVisibility.PUBLIC &&
    (bot.projectId === null || task.projectId === bot.projectId)
  ) {
    return;
  }
  throw forbidden(
    "A shared Soko Bot takes only public Tasks in its Project or workspace",
  );
}
