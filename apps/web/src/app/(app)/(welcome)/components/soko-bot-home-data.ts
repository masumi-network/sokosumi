import type {
  ChatRoom,
  ChatRoomMessage,
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
  /** The reader's newest message there, which the row opens at. */
  messageId: string;
  /** That message as plain text: what the chat was about, in their words. */
  title: string;
  /** Last activity in the room, the bot's answer included. */
  at: Date;
}

/** Rooms worth reading messages for: at most this many per Home load. */
export const SOKO_BOT_HOME_CHAT_LIMIT = 3;

/**
 * The reader's rooms with a Soko Bot that moved in the 24 hours before
 * `now`, newest first, in the active workspace only (`organizationId` is
 * null for a personal one): a guest room or another workspace's bot stays
 * off this Home. Room `updatedAt` advances on every message.
 */
export function recentSokoBotRooms(
  rooms: readonly ChatRoom[],
  organizationId: string | null,
  now: Date,
  limit = SOKO_BOT_HOME_CHAT_LIMIT,
): ChatRoom[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return [...byId.values()]
    .filter(
      (room) =>
        room.sokoBotMembers.length > 0 &&
        room.organizationId === organizationId &&
        now.getTime() - room.updatedAt.getTime() <= DAY_MS,
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}

/**
 * The room as a chat row when the reader wrote in it during the last day;
 * null when only the bot spoke (its welcome, a schedule) or they wrote
 * nothing with text. `allLabel` is what the room-wide mention reads as.
 */
export function toSokoBotChat(
  room: ChatRoom,
  messages: readonly ChatRoomMessage[],
  userId: string,
  now: Date,
  allLabel: string,
): SokoBotHomeChat | null {
  const names = roomMentionNames(room, allLabel);
  const mine = messages
    .filter(
      (message) =>
        message.sender.type === "user" &&
        message.sender.user.id === userId &&
        message.deletedAt === null &&
        now.getTime() - message.createdAt.getTime() <= DAY_MS,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((message) => ({
      message,
      title: buildChatMessagePreview(message.content, names),
    }))
    .find(({ title }) => title.length > 0);
  return mine
    ? {
        roomId: room.id,
        messageId: mine.message.id,
        title: mine.title,
        at: room.updatedAt,
      }
    : null;
}
