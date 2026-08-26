import prisma from "@/lib/db/prisma";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

const DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SokoBotDailyStats {
  days: number;
  proactive: { usedToday: number; limit: number; paused: boolean };
  totals: SokoBotDayStats;
  daily: (SokoBotDayStats & { date: string })[];
}

export interface SokoBotDayStats {
  /** Turns the owner started from chat. */
  messages: number;
  /** Turns the bot started on its own: schedules and coworker events. */
  background: number;
  /** Coworker Tasks it created. */
  tasks: number;
  /** Marketplace Agents it hired. */
  jobs: number;
  /** Tool calls it made across all turns. */
  toolCalls: number;
}

function emptyDay(): SokoBotDayStats {
  return { messages: 0, background: 0, tasks: 0, jobs: 0, toolCalls: 0 };
}

/** What one bot did per day over the last 30 days, oldest first. */
export async function getSokoBotDailyStats(input: {
  userId: string;
  workspaceId: string;
}): Promise<SokoBotDailyStats | null> {
  const bot = await prisma.sokoBot.findFirst({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!bot) return null;
  const since = new Date(Date.now() - DAYS * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const [turns, delegations, toolCalls] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: { sokoBotId: bot.id, createdAt: { gte: since } },
      select: { createdAt: true, source: true },
    }),
    prisma.sokoBotDelegation.findMany({
      where: {
        turn: { sokoBotId: bot.id },
        createdAt: { gte: since },
        action: { in: ["create_task", "hire_agent"] },
      },
      select: { createdAt: true, kind: true },
    }),
    prisma.sokoBotToolCall.findMany({
      where: { turn: { sokoBotId: bot.id }, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);

  const byDay = new Map<string, SokoBotDayStats>();
  const day = (at: Date) => {
    const key = at.toISOString().slice(0, 10);
    const row = byDay.get(key) ?? emptyDay();
    byDay.set(key, row);
    return row;
  };
  for (const turn of turns) {
    if (turn.source === "CHAT") day(turn.createdAt).messages += 1;
    else if (turn.source !== "ADMIN_RETRY") day(turn.createdAt).background += 1;
  }
  for (const delegation of delegations) {
    if (delegation.kind === "TASK") day(delegation.createdAt).tasks += 1;
    else day(delegation.createdAt).jobs += 1;
  }
  for (const call of toolCalls) day(call.createdAt).toolCalls += 1;

  const totals = emptyDay();
  const daily: SokoBotDailyStats["daily"] = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(date) ?? emptyDay();
    daily.push({ date, ...row });
    for (const key of Object.keys(totals) as (keyof SokoBotDayStats)[]) {
      totals[key] += row[key];
    }
  }
  const gate = await proactiveGate(bot.id);
  const paused = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: bot.id },
    select: { proactivePaused: true },
  });
  return {
    days: DAYS,
    proactive: {
      usedToday: gate.usedToday,
      limit: gate.limit,
      paused: paused.proactivePaused || gate.reason === "global-pause",
    },
    totals,
    daily,
  };
}
