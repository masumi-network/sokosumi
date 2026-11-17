import type { Prisma } from "@sokosumi/database";

import { userSummaryFromLoadedRelation } from "@/helpers/loaded-relation-summaries";

/**
 * A personal Soko Bot that receives a subscribed participant's Task moments.
 * Archived, deleted or paused bots do not: those moments go to the bell.
 */
export const followingSokoBotWhere = {
  projectId: null,
  archivedAt: null,
  deletedAt: null,
  proactivePaused: false,
  adminPausedAt: null,
} satisfies Prisma.SokoBotWhereInput;

/** The same rule as `followingSokoBotWhere`, for a bot already loaded. */
export function isFollowingSokoBot(bot: {
  projectId: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  proactivePaused: boolean;
  adminPausedAt: Date | null;
}): boolean {
  return (
    bot.projectId === null &&
    bot.archivedAt === null &&
    bot.deletedAt === null &&
    !bot.proactivePaused &&
    bot.adminPausedAt === null
  );
}

/** Participant row include for every response that lists participants. */
export const taskParticipantRowInclude = {
  user: {
    select: {
      id: true,
      name: true,
      image: true,
      sokoBots: {
        where: followingSokoBotWhere,
        select: { workspaceId: true },
      },
    },
  },
} as const;

type TaskParticipantRow = Prisma.TaskParticipantGetPayload<{
  include: typeof taskParticipantRowInclude;
}>;

export function mapTaskParticipantRows(
  task: { id: string; workspaceId: string },
  rows: readonly TaskParticipantRow[],
) {
  return rows.map((row) => ({
    user: userSummaryFromLoadedRelation(
      `Task ${task.id} participant`,
      row.userId,
      row.user,
    ),
    addedAt: row.createdAt,
    subscribedAt: row.subscribedAt,
    followsWithSokoBot:
      row.subscribedAt !== null &&
      row.user.sokoBots.some((bot) => bot.workspaceId === task.workspaceId),
  }));
}
