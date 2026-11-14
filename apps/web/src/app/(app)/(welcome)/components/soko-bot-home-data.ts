import {
  type ChatCatchUpItem,
  type ChatRoom,
  type SokoBotSchedule,
  type SokoBotState,
  SokoBotStatus,
  type TaskListItem,
} from "@sokosumi/core-client";
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
