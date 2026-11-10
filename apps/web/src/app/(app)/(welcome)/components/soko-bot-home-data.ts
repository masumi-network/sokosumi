import type {
  ChatRecentSokoBotMessage,
  ChatRoom,
  TaskListItem,
} from "@sokosumi/core-client";
import { buildChatMessagePreview } from "@sokosumi/utils";

import { roomMentionNames } from "@/app/chat/utils/room-mention-names";

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

/** A Task the team moved in the last day, as one row of the home. */
export interface SokoBotHomeTask {
  id: string;
  name: string;
  status: TaskListItem["status"];
  updatedAt: Date;
  /** Who it is with: the assignee, else whoever owns it. */
  who: string | null;
}

export const SOKO_BOT_HOME_TASK_LIMIT = 8;
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
  limit = SOKO_BOT_HOME_TASK_LIMIT,
): SokoBotHomeTask[] {
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

/** A chat with a Soko Bot the reader took part in during the last day. */
export interface SokoBotHomeChat {
  roomId: string;
  /** The reader's newest message there, a Thread reply included; the row
   * opens at it. */
  messageId: string;
  /** That message as plain text: what the chat was about, in their words. */
  title: string;
  /** Last activity: the room's, or the reader's reply when that is newer
   * (a reply leaves the room's timestamp alone). */
  at: Date;
}

/**
 * Core's per-room newest reader messages as Home rows. Core already picked
 * the reader's own messages in this workspace's Soko Bot rooms, Thread
 * replies included, newest first and capped; the room list supplies the
 * names a mention token carries. A room missing from that list is left
 * out. `allLabel` is what the room-wide mention reads as; `untitled` names
 * a message with no text.
 */
export function toSokoBotChats(
  recent: readonly ChatRecentSokoBotMessage[],
  rooms: readonly ChatRoom[],
  allLabel: string,
  untitled: string,
): SokoBotHomeChat[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return recent.flatMap((message) => {
    const room = byId.get(message.roomId);
    if (!room) return [];
    return [
      {
        roomId: room.id,
        messageId: message.messageId,
        title:
          buildChatMessagePreview(
            message.content,
            roomMentionNames(room, allLabel),
          ) || untitled,
        at:
          message.createdAt > room.updatedAt
            ? message.createdAt
            : room.updatedAt,
      },
    ];
  });
}
