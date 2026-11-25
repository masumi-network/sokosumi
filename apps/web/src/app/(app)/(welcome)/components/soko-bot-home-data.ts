import {
  type ChatCatchUpItem,
  type ChatRoom,
  type ChatRoomMessage,
  type SokoBotSchedule,
  type SokoBotState,
  SokoBotStatus,
  type TaskListItem,
} from "@sokosumi/core-client";
import { isSokoBotIntroduction } from "@sokosumi/soko-bot";
import { buildChatMessagePreview } from "@sokosumi/utils";
import type { NeedsYouLead } from "@/app/projects/components/needs-you-panel-list";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

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

/**
 * Home's Needs you row for a bot in error. A failed chat reply in a room the
 * reader belongs to opens that reply, Direct or channel alike; anything else
 * (scheduled or event work, a room they cannot open) says the bot could not
 * finish its work and opens the bot's page, which lists its turns.
 */
export function sokoBotFailureLead(
  bot: { name: string; status: SokoBotStatus },
  lastFailure: SokoBotState["lastFailure"] | null,
  t: (
    key: "failedReply" | "failedWork" | "openChat" | "openBot",
    values?: { name: string },
  ) => string,
): NeedsYouLead | undefined {
  if (bot.status !== SokoBotStatus.ERROR) return undefined;
  const name = { name: bot.name };
  return lastFailure?.roomId && lastFailure.messageId
    ? {
        title: t("failedReply", name),
        detail: t("openChat"),
        href: chatRoomMessageHref(lastFailure.roomId, lastFailure.messageId),
      }
    : {
        title: t("failedWork", name),
        detail: t("openBot", name),
        href: SOKO_BOT_ROUTE,
      };
}

/** The bot's Direct as Home reads it: its newest top-level messages. */
export interface SokoBotHomeRoom {
  roomId: string;
  /** Oldest first, deleted ones included. */
  messages: readonly ChatRoomMessage[];
  /** Where the reader's Unread divider sits, from the same read; null when
   * nothing is unread. */
  firstUnreadMessageId: string | null;
}

/**
 * Home's Needs you row for the bot's welcome while the reader has not read
 * it. The welcome is the bot's message Core marked as its introduction, so a
 * rename does not hide it and an owner notice is never one. It is unread
 * while the room's Unread divider sits right above it.
 */
export function sokoBotWelcomeLead(
  bot: { id: string; name: string },
  /** Core's introduction text for today's names, for unmarked older ones. */
  introduction: string,
  botRoom: SokoBotHomeRoom | null,
  t: (key: "welcome" | "openChat", values?: { name: string }) => string,
): NeedsYouLead | undefined {
  const welcome = botRoom?.messages.find(
    (message) =>
      message.id === botRoom.firstUnreadMessageId &&
      !message.deletedAt &&
      message.sender.type === "sokoBot" &&
      message.sender.sokoBot.id === bot.id &&
      // ponytail: introductions posted before the marker match on Core's
      // text, so a rename before reading hides those rows (never labels a
      // notice). Drop the fallback once no unmarked one can still be unread.
      (isSokoBotIntroduction(message.metadata) ||
        message.content === introduction),
  );
  if (!botRoom || !welcome) return undefined;
  return {
    title: t("welcome", { name: bot.name }),
    detail: t("openChat"),
    href: chatRoomMessageHref(botRoom.roomId, welcome.id),
    at: welcome.createdAt,
    kind: "message",
  };
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

/** A schedule the reader's bot got in the last day, as one row of the home. */
export interface SokoBotHomeSchedule {
  id: string;
  name: string;
  createdAt: Date;
}

/**
 * The bot's own schedules set up in the 24 hours before `now`, newest first.
 * Built-in rhythms come with every bot, so they are not news.
 */
export function toNewSchedules(
  schedules: readonly Pick<
    SokoBotSchedule,
    "id" | "name" | "systemKey" | "createdAt"
  >[],
  now: Date,
  limit = SOKO_BOT_HOME_TASK_LIMIT,
): SokoBotHomeSchedule[] {
  return schedules
    .filter(
      (schedule) =>
        !schedule.systemKey &&
        now.getTime() - schedule.createdAt.getTime() <= DAY_MS,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

/**
 * An important chat message from someone else that the reader has not read,
 * from the last day: a request, a decision, a blocker and the like.
 */
export interface SokoBotHomeChat {
  roomId: string;
  /** The row opens at it, a Thread reply included. */
  messageId: string;
  /** The message as plain text, mentions named. */
  title: string;
  /** Who wrote it: a person, a Coworker or a Soko Bot. */
  from: string;
  at: Date;
}

/**
 * Core's important messages as Home rows, in Core's order: newest first,
 * one per room. `untitled` names a message with no text.
 */
export function toImportantChats(
  items: readonly ChatCatchUpItem[],
  untitled: string,
): SokoBotHomeChat[] {
  return items.map((item) => ({
    roomId: item.roomId,
    messageId: item.messageId,
    title: item.excerpt || untitled,
    from: item.senderName,
    at: item.createdAt,
  }));
}

/**
 * Adds the reader's latest chat with their Soko Bot as one row, read or not,
 * so a first chat shows on Home. `messages` is the bot's Direct, oldest
 * first. While the reader's latest question waits, the row shows it ("You to
 * Juno"); once the bot posts after it, the row shows the bot's newest such
 * message ("Juno replied"), so Home says the answer is there. The row is
 * dated by the message it shows. Nothing when the question is over a day old,
 * so a bot post today does not revive an old chat, when the reader never
 * asked, or when an unread row from that room is already listed: that one
 * points at what is new.
 */
export function withSokoBotChat(
  chats: SokoBotHomeChat[],
  botRoom: { roomId: string; messages: readonly ChatRoomMessage[] } | null,
  reader: {
    userId: string;
    /** Names a question: the reader to the bot. */
    from: string;
    botId: string;
    /** Names a reply: the bot replied. */
    replied: string;
    untitled: string;
  },
  now: Date,
): SokoBotHomeChat[] {
  if (!botRoom || chats.some((chat) => chat.roomId === botRoom.roomId)) {
    return chats;
  }
  const at = botRoom.messages.findLastIndex(
    (message) =>
      !message.deletedAt &&
      message.sender.type === "user" &&
      message.sender.user.id === reader.userId,
  );
  const question = botRoom.messages[at];
  if (!question || now.getTime() - question.createdAt.getTime() > DAY_MS) {
    return chats;
  }
  const reply = botRoom.messages
    .slice(at + 1)
    .findLast(
      (message) =>
        !message.deletedAt &&
        message.sender.type === "sokoBot" &&
        message.sender.sokoBot.id === reader.botId,
    );
  const shown = reply ?? question;
  return [
    ...chats,
    {
      roomId: botRoom.roomId,
      messageId: shown.id,
      title: buildChatMessagePreview(shown.content) || reader.untitled,
      from: reply ? reader.replied : reader.from,
      at: shown.createdAt,
    },
  ];
}
