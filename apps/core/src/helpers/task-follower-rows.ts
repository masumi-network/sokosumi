import type { Prisma } from "@sokosumi/database";

import { userSummaryFromLoadedRelation } from "@/helpers/loaded-relation-summaries";

/** A personal Soko Bot that exists: the one a person can follow with. */
export const personalSokoBotWhere = {
  projectId: null,
  archivedAt: null,
  deletedAt: null,
} satisfies Prisma.SokoBotWhereInput;

/**
 * A personal Soko Bot that receives a follower's Task moments. A paused bot
 * does not: while it is paused, those moments go to the bell.
 */
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

/** Follower row include for every response that lists followers. */
export const taskFollowerRowInclude = {
  user: { select: { id: true, name: true, image: true } },
} as const;

/** Followers in follow order: UUID v7 ids sort by creation. */
export const taskFollowersInclude = {
  followers: {
    orderBy: { id: "asc" as const },
    include: taskFollowerRowInclude,
  },
} as const;

type TaskFollowerRow = Prisma.TaskFollowerGetPayload<{
  include: typeof taskFollowerRowInclude;
}>;

export function mapTaskFollowerRows(
  task: { id: string },
  rows: readonly TaskFollowerRow[],
) {
  return rows.map((row) => ({
    user: userSummaryFromLoadedRelation(
      `Task ${task.id} follower`,
      row.userId,
      row.user,
    ),
    followedAt: row.createdAt,
  }));
}
