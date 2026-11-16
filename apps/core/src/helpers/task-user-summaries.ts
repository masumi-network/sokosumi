import type { Prisma } from "@sokosumi/database";

import type { UserSummaryFields } from "@/helpers/loaded-relation-summaries";
import prisma, { type DbClient } from "@/lib/db/prisma";
import type {
  TaskListItemWithIncludes,
  taskEventListInclude,
  taskListReadInclude,
} from "@/types/task";

type TaskListRead = Prisma.TaskGetPayload<{
  include: typeof taskListReadInclude;
}>;

type TaskEventListRead = Prisma.TaskEventGetPayload<{
  include: typeof taskEventListInclude;
}>;

export type TaskEventListItem = TaskEventListRead & {
  user: UserSummaryFields | null;
  sokoBot:
    | (NonNullable<TaskEventListRead["sokoBot"]> & {
        user: UserSummaryFields | null;
      })
    | null;
};

function uniqueIds(ids: Iterable<string | null | undefined>) {
  const unique = new Set<string>();
  for (const id of ids) {
    if (id) unique.add(id);
  }
  return [...unique];
}

/**
 * One user summary read for every id. An empty list is not a query.
 * A database error propagates; a missing row stays absent so mapping throws.
 */
export async function findUserSummariesById(
  ids: Iterable<string | null | undefined>,
  client: DbClient = prisma,
): Promise<Map<string, UserSummaryFields>> {
  const userIds = uniqueIds(ids);
  if (userIds.length === 0) return new Map();
  const users = await client.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, image: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

function summaryFor(
  users: Map<string, UserSummaryFields>,
  id: string | null | undefined,
) {
  if (!id) return null;
  return users.get(id) ?? null;
}

function withBotOwner<T extends { userId: string | null }>(
  bot: T | null,
  users: Map<string, UserSummaryFields>,
) {
  if (!bot) return null;
  return { ...bot, user: summaryFor(users, bot.userId) };
}

export function attachTaskListUsers(
  task: TaskListRead,
  users: Map<string, UserSummaryFields>,
): TaskListItemWithIncludes {
  return {
    ...task,
    owner: summaryFor(users, task.ownerId),
    assigneeUser: summaryFor(users, task.assigneeUserId),
    creatorUser: summaryFor(users, task.creatorUserId),
    creatorSokoBot: withBotOwner(task.creatorSokoBot, users),
    assigneeSokoBot: withBotOwner(task.assigneeSokoBot, users),
    participants: task.participants.map((row) => {
      const user = users.get(row.userId);
      if (!user) {
        throw new Error(
          `Task ${task.id} participant ${row.userId} user summary was not loaded`,
        );
      }
      return { ...row, user };
    }),
  };
}

export function taskListUserIds(task: TaskListRead) {
  return [
    task.ownerId,
    task.assigneeUserId,
    task.creatorUserId,
    task.creatorSokoBot?.userId,
    task.assigneeSokoBot?.userId,
    ...task.participants.map((row) => row.userId),
  ];
}

export function attachTaskEventUsers(
  event: TaskEventListRead,
  users: Map<string, UserSummaryFields>,
): TaskEventListItem {
  return {
    ...event,
    user: summaryFor(users, event.userId),
    sokoBot: withBotOwner(event.sokoBot, users),
  };
}

export function taskEventUserIds(event: TaskEventListRead) {
  return [event.userId, event.sokoBot?.userId];
}
