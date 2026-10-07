import { convertCentsToCredits } from "@sokosumi/utils";

import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { roundCredits } from "@/lib/soko-bot/task-charges";

export interface ActivityStatsBot {
  id: string;
  name?: string | null;
  userId: string;
  workspaceId: string;
}

export interface ActivityStats {
  own: { created: number; completed: number; failed: number; viaBot: number };
  ownerMessages: number;
  botTurns: number;
  botMessages: number;
  botCredits: number;
  coworkerCredits: { name: string; credits: number }[];
  team: { name: string; completed: number; created: number }[];
}

const TEAM_LIMIT = 8;

/**
 * What happened in a window, counted in Core so a review leads with numbers
 * instead of the bot guessing from a page of Tasks.
 */
export async function activityStats(
  bot: ActivityStatsBot,
  since: Date,
  until: Date,
): Promise<ActivityStats> {
  const window = { gte: since, lt: until };
  const ownTask = { workspaceId: bot.workspaceId, ownerId: bot.userId };
  const finished = (status: "COMPLETED" | "FAILED", extra: object = {}) =>
    prisma.taskEvent
      .findMany({
        where: { status, createdAt: window, task: { ...ownTask, ...extra } },
        select: { taskId: true },
        distinct: ["taskId"],
      })
      .then((rows) => rows.length);
  const visible = buildSokoBotOwnerTaskVisibilityWhere(bot.userId);
  const [
    created,
    completed,
    failed,
    viaBot,
    ownerMessages,
    botTurns,
    botMessages,
    botUsage,
    debits,
    teamCreated,
    teamCompleted,
  ] = await Promise.all([
    prisma.task.count({ where: { ...ownTask, createdAt: window } }),
    finished("COMPLETED"),
    finished("FAILED"),
    finished("COMPLETED", {
      sokoBotDelegations: { some: { turn: { sokoBotId: bot.id } } },
    }),
    prisma.chatRoomMessage.count({
      where: { senderUserId: bot.userId, createdAt: window, deletedAt: null },
    }),
    prisma.sokoBotTurn.count({
      where: { sokoBotId: bot.id, createdAt: window },
    }),
    prisma.chatRoomMessage.count({
      where: { senderSokoBotId: bot.id, createdAt: window, deletedAt: null },
    }),
    prisma.sokoBotUsage.aggregate({
      where: { sokoBotId: bot.id, createdAt: window },
      _sum: { cents: true },
    }),
    prisma.taskEvent.findMany({
      where: {
        createdAt: window,
        task: ownTask,
        transaction: { amount: { lt: 0 } },
      },
      select: {
        transaction: { select: { amount: true } },
        task: { select: { assignee: { select: { name: true } } } },
      },
    }),
    prisma.task.findMany({
      where: {
        workspaceId: bot.workspaceId,
        createdAt: window,
        NOT: { ownerId: bot.userId },
        AND: [visible],
      },
      select: { owner: { select: { name: true } } },
      take: 1000,
    }),
    prisma.taskEvent.findMany({
      where: {
        status: "COMPLETED",
        createdAt: window,
        task: {
          workspaceId: bot.workspaceId,
          NOT: { ownerId: bot.userId },
          AND: [visible],
        },
      },
      select: {
        taskId: true,
        task: { select: { owner: { select: { name: true } } } },
      },
      distinct: ["taskId"],
      take: 1000,
    }),
  ]);

  const byCoworker = new Map<string, number>();
  for (const debit of debits) {
    const amount = debit.transaction?.amount;
    if (amount == null) continue;
    const who = debit.task.assignee?.name ?? "Unassigned";
    byCoworker.set(
      who,
      (byCoworker.get(who) ?? 0) + convertCentsToCredits(-amount),
    );
  }

  const team = new Map<string, { completed: number; created: number }>();
  const person = (name: string | null) => name?.trim() || "A teammate";
  for (const task of teamCreated) {
    const row = team.get(person(task.owner.name)) ?? {
      completed: 0,
      created: 0,
    };
    row.created += 1;
    team.set(person(task.owner.name), row);
  }
  for (const event of teamCompleted) {
    const name = person(event.task.owner.name);
    const row = team.get(name) ?? { completed: 0, created: 0 };
    row.completed += 1;
    team.set(name, row);
  }

  return {
    own: { created, completed, failed, viaBot },
    ownerMessages,
    botTurns,
    botMessages,
    botCredits: roundCredits(convertCentsToCredits(botUsage._sum.cents ?? 0n)),
    coworkerCredits: [...byCoworker]
      .map(([name, credits]) => ({ name, credits: roundCredits(credits) }))
      .sort((a, b) => b.credits - a.credits),
    team: [...team]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.completed + b.created - (a.completed + a.created))
      .slice(0, TEAM_LIMIT),
  };
}

/** The numbers as packet lines, headed with the window they cover. */
export function activityStatsLines(
  stats: ActivityStats,
  heading: string,
  botName: string | null,
): string[] {
  const bot = botName?.trim() || "your assistant";
  const coworkerTotal = stats.coworkerCredits.reduce(
    (total, row) => total + row.credits,
    0,
  );
  const lines = [
    `## ${heading}`,
    `- Your Tasks: ${stats.own.created} created, ${stats.own.completed} completed, ${stats.own.failed} failed (${stats.own.viaBot} completed through ${bot})`,
    `- Chat: you sent ${stats.ownerMessages} messages; ${bot} ran ${stats.botTurns} turns and posted ${stats.botMessages} messages`,
    `- Credits: ${roundCredits(stats.botCredits + coworkerTotal)} in total, ${stats.botCredits} for ${bot}${stats.coworkerCredits.length ? `, ${stats.coworkerCredits.map((row) => `${row.name} ${row.credits}`).join(", ")}` : ""}`,
  ];
  if (stats.team.length > 0)
    lines.push(
      `- Team: ${stats.team.map((row) => `${row.name} ${row.completed} completed / ${row.created} created`).join("; ")}`,
    );
  lines.push("");
  return lines;
}
