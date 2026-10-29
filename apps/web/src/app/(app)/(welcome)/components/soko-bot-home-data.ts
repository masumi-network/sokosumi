import type { ChatRoom, TaskListItem } from "@sokosumi/core-client";

type TeamTask = Pick<
  TaskListItem,
  "id" | "name" | "status" | "updatedAt" | "assignee" | "owner"
>;

/**
 * The user's 1:1 with this bot: a Direct whose only agent is the bot, the
 * same room `ensureSokoBotDirectRoomAction` creates or returns.
 */
export function findSokoBotDirectRoom(
  rooms: readonly ChatRoom[],
  sokoBotId: string,
): ChatRoom | null {
  return (
    rooms.find(
      (room) =>
        room.kind === "direct" &&
        room.coworkerMembers.length === 0 &&
        room.userMembers.length <= 1 &&
        room.sokoBotMembers.length === 1 &&
        room.sokoBotMembers[0]?.id === sokoBotId,
    ) ?? null
  );
}

/** A Task the team moved in the last day, as one row of Home's team day. */
export interface TeamDayTask {
  id: string;
  name: string;
  status: TaskListItem["status"];
  updatedAt: Date;
  /** Who it is with: the assignee, else whoever owns it. */
  who: string | null;
}

export const TEAM_DAY_TASK_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function taskWho(task: TeamTask): string | null {
  const assignee = task.assignee;
  if (assignee?.type === "user") return assignee.user.name;
  if (assignee?.type === "coworker") return assignee.coworker.name;
  if (assignee?.type === "sokoBot") return assignee.sokoBot.name;
  return task.owner?.name ?? null;
}

/** Tasks touched in the 24 hours before `now`, newest first. */
export function toTeamDay(
  tasks: readonly TeamTask[],
  now: Date,
  limit = TEAM_DAY_TASK_LIMIT,
): TeamDayTask[] {
  return tasks
    .filter((task) => now.getTime() - task.updatedAt.getTime() <= DAY_MS)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      updatedAt: task.updatedAt,
      who: taskWho(task),
    }));
}
